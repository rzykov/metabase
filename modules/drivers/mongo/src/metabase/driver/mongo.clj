(ns metabase.driver.mongo
  "MongoDB Driver."
  (:require
   [cheshire.core :as json]
   [cheshire.generate :as json.generate]
   [clojure.string :as str]
   [clojure.walk :as walk]
   [medley.core :as m]
   [metabase.db.metadata-queries :as metadata-queries]
   [metabase.driver :as driver]
   [metabase.driver.mongo.connection :as mongo.connection]
   [metabase.driver.mongo.database :as mongo.db]
   [metabase.driver.mongo.execute :as mongo.execute]
   [metabase.driver.mongo.json]
   [metabase.driver.mongo.parameters :as mongo.params]
   [metabase.driver.mongo.query-processor :as mongo.qp]
   [metabase.driver.mongo.util :as mongo.util]
   [metabase.driver.util :as driver.u]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.metadata.protocols :as lib.metadata.protocols]
   [metabase.lib.schema.common :as lib.schema.common]
   [metabase.query-processor :as qp]
   [metabase.query-processor.store :as qp.store]
   [metabase.util :as u]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [taoensso.nippy :as nippy])
  (:import
   (com.mongodb.client MongoClient MongoDatabase)
   (org.bson.types ObjectId)))

(set! *warn-on-reflection* true)

(comment metabase.driver.mongo.json/keep-me)

;; JSON Encoding (etc.)

;; Encode BSON undefined like `nil`
(json.generate/add-encoder org.bson.BsonUndefined json.generate/encode-nil)

(nippy/extend-freeze ObjectId :mongodb/ObjectId
                     [^ObjectId oid data-output]
                     (.writeUTF data-output (.toHexString oid)))

(nippy/extend-thaw :mongodb/ObjectId
  [data-input]
  (ObjectId. (.readUTF data-input)))

(driver/register! :mongo)

(defmethod driver/can-connect? :mongo
  [_ db-details]
  (mongo.connection/with-mongo-client [^MongoClient c db-details]
    (let [db-names (mongo.util/list-database-names c)
          db-name (mongo.db/db-name db-details)
          db (mongo.util/database c db-name)
          db-stats (mongo.util/run-command db {:dbStats 1} :keywordize true)]
      (and
       ;; 1. check db.dbStats command completes successfully
       (= (float (:ok db-stats))
          1.0)
       ;; 2. check the database is actually on the server
       ;; (this is required because (1) is true even if the database doesn't exist)
       (boolean (some #(= % db-name) db-names))))))

(defmethod driver/humanize-connection-error-message
  :mongo
  [_ message]
  (condp re-matches message
    #"^Timed out after \d+ ms while waiting for a server .*$"
    :cannot-connect-check-host-and-port

    #"^host and port should be specified in host:port format$"
    :invalid-hostname

    #"^Password can not be null when the authentication mechanism is unspecified$"
    :password-required

    #"^org.apache.sshd.common.SshException: No more authentication methods available$"
    :ssh-tunnel-auth-fail

    #"^java.net.ConnectException: Connection refused$"
    :ssh-tunnel-connection-fail

    #".*javax.net.ssl.SSLHandshakeException: PKIX path building failed.*"
    :certificate-not-trusted

    #".*MongoSocketReadException: Prematurely reached end of stream.*"
    :requires-ssl

    #".* KeyFactory not available"
    :unsupported-ssl-key-type

    #"java.security.InvalidKeyException: invalid key format"
    :invalid-key-format

    message))


;;; ### Syncing

(declare update-field-attrs)

(defmethod driver/sync-in-context :mongo
  [_ database do-sync-fn]
  (mongo.connection/with-mongo-client [_ database]
    (do-sync-fn)))

(defmethod driver/dbms-version :mongo
  [_driver database]
  (mongo.connection/with-mongo-database [db database]
    (let [build-info (mongo.util/run-command db {:buildInfo 1})
          version-array (get build-info "versionArray")
          sanitized-version-array (into [] (take-while nat-int?) version-array)]
      (when (not= (take 3 version-array) (take 3 sanitized-version-array))
        (log/warnf "sanitizing versionArray %s results in %s, losing information"
                   version-array sanitized-version-array))
      {:version (get build-info "version")
       :semantic-version sanitized-version-array})))

(defmethod driver/describe-database :mongo
  [_ database]
  (mongo.connection/with-mongo-database [^MongoDatabase db database]
    {:tables (set (for [collection (mongo.util/list-collection-names db)
                        :when (not= collection "system.indexes")]
                    {:schema nil, :name collection}))}))

(defmethod driver/describe-table-indexes :mongo
  [_ database table]
  (mongo.connection/with-mongo-database [^MongoDatabase db database]
    (let [collection (mongo.util/collection db (:name table))]
      (->> (mongo.util/list-indexes collection)
           (map (fn [index]
                ;; for text indexes, column names are specified in the weights
                  (if (contains? index "textIndexVersion")
                    (get index "weights")
                    (get index "key"))))
           (map (comp name first keys))
           ;; mongo support multi key index, aka nested fields index, so we need to split the keys
           ;; and represent it as a list of field names
           (map #(if (str/includes? % ".")
                   {:type  :nested-column-index
                    :value (str/split % #"\.")}
                   {:type  :normal-column-index
                    :value %}))
           set))))

(defn- sample-stages
  "Query stages which get a sample of the data in the collection, of size `n`. Half of the sample is from the first
   inserted documents and the other half from the last inserted documents."
  [collection-name n]
  (let [start-n (quot n 2)
        end-n   (- n start-n)]
    [{"$sort" {"_id" 1}}
     {"$limit" start-n}
     {"$unionWith"
      {"coll" collection-name
       "pipeline" [{"$sort" {"_id" -1}}
                   {"$limit" end-n}]}}]))

(defn- depth-k    [depth] (str "depth" depth "K"))
(defn- depth-type [depth] (str "depth" depth "Type"))
(defn- depth-idx  [depth] (str "depth" depth "Index"))
(defn- depth-kvs  [depth] (str "depth" depth "Kvs"))

(defn- project-nested-fields [max-depth depth]
  (cond-> [{"$addFields"
            (merge
             {(depth-k depth)    (str "$" (depth-kvs depth) ".k")
              (depth-idx depth)  (str "$" (depth-idx depth))
              (depth-type depth) {"$type" (str "$" (depth-kvs depth) ".v")}})}]
    ;; if depth is not the max-depth, add kvs from any objects
    (not= depth max-depth)
    (into [{"$addFields"
            {(depth-kvs (inc depth))
             {"$cond" {"if"   {"$eq" [{"$type" (str "$" (depth-kvs depth) ".v")}, "object"]}
                       "then" {"$concatArrays" [[{"k" nil "v" nil}] ; this is so that the object is selected as well
                                                {"$objectToArray" (str "$" (depth-kvs depth) ".v")}]}
                       "else" [{"k" nil "v" nil}]}}}}
           {"$unwind"
            {"path"                       (str "$" (depth-kvs (inc depth)))
             "includeArrayIndex"          (depth-idx (inc depth))
             "preserveNullAndEmptyArrays" true}}])))

(defn- facet-stage [root-path depth]
  (let [depths (range (inc depth))]
    [{"$match" {(depth-k depth) {"$ne" nil}}}
     {"$group" {"_id" (into {"type" (str "$" (depth-type depth))
                             "path" {"$concat" (concat (when (not= root-path "$ROOT") [root-path "."])
                                                       (interpose "."
                                                                  (map #(str "$" (depth-k %)) depths)))}
                             "k"    (str "$" (depth-k depth))})
                ;; "sortKey" is constructed so that sorting fields by "sortKey" under each parent field
                ;; yields a stable database-position. The way database-position would be set with imperative
                ;; pseudocode:
                ;; i = 0
                ;; for each row in sample-row:
                ;;   for each k,v in row:
                ;;     database-position = i
                ;;     i = i + 1
                "sortKey" {"$min" {"$concat" [{"$toString" "$_id"}
                                              "."
                                              {"$toString" (str "$" (depth-idx depth))}]}}
                "count"   {"$sum" 1}}}
     {"$sort" {"count" -1}}
     {"$group" {"_id"     {"path" "$_id.path", "k" "$_id.k"}
                "sortKey" {"$min" "$sortKey"}
                "types"   {"$push" {"type" (str "$_id.type")}}}}
     {"$project" {"_id"            0
                  "path"           "$_id.path"
                  "k"              "$_id.k"
                  "sortKey"        1
                  "mostCommonType" {"$cond" {"if"   {"$eq" [{"$arrayElemAt" ["$types.type", 0]}, "null"]}
                                             "then" {"$ifNull" [{"$arrayElemAt" ["$types.type", 1]}, "null"]}
                                             "else" {"$arrayElemAt" ["$types.type", 0]}}}}}]))

(defn- project-from-root [root-path]
  [{"$project" {"path" root-path, (depth-kvs 0) {"$objectToArray" (str "$" root-path)}}}
   {"$unwind" {"path" (str "$" (depth-kvs 0)), "includeArrayIndex" (depth-idx 0)}}])

(defn- describe-table-query [collection-name sample-size max-depth root-path]
  (let [all-depths (range (inc max-depth))
        facets     (into {} (map (juxt #(str "depth" %) #(facet-stage root-path %)) all-depths))]
    (concat (sample-stages collection-name sample-size)
            (project-from-root root-path)
            (mapcat #(project-nested-fields max-depth %) all-depths)
            [{"$facet" facets}
             {"$project" {"allFields" {"$concatArrays" (mapv #(str "$" %) (keys facets))}}}
             {"$unwind" "$allFields"}])))

(defn- path->depth [path]
  (dec (count (str/split path #"\."))))

(def describe-table-query-depth
  "The depth of nested objects that [[describe-table-query]] will execute to. If set to 0, the query will only return the
   fields under `root-path`, and nested fields will be queried with further executions. If set to K, the query will
   return fields at K levels of nesting. Setting its value involves a trade-off: the lower it is, the faster
   describe-table-query executes, but the more queries we might have to execute."
  5)

(mu/defn- describe-table :- [:sequential
                             [:map {:closed true}
                              [:path           ::lib.schema.common/non-blank-string]
                              [:k              ::lib.schema.common/non-blank-string]
                              [:sortKey        ::lib.schema.common/non-blank-string]
                              [:mostCommonType ::lib.schema.common/non-blank-string]]]
  "Queries the database for a sample of the data in `table` and returns a list of field information. Because Mongo
   documents can have many levels of nesting (up to 200) than we can query with one query, we query the fields at the
   root first, which gets all the fields until a depth of [[describe-table-query-depth]]. Then for any objects at that
   depth, we recursively query the database for fields nested inside those objects."
  [db table]
  (let [collection-name (:name table)
        ;; Cal 2024-08-14: sample-size is twice [[metadata-queries/nested-field-sample-limit]] for backwards
        ;; compatibility, because this is how the sample was created before. I'm not sure why.
        sample-size (* metadata-queries/nested-field-sample-limit 2)
        q! (fn [q]
             (:rows (:data (qp/process-query {:database (:id db)
                                              :type     "native"
                                              :native   {:collection collection-name
                                                         :query      (json/generate-string q)}}))))
        nested-fields (fn nested-fields [path]
                        (let [fields (flatten (q! (describe-table-query collection-name sample-size describe-table-query-depth path)))
                              nested (->> fields
                                          (filter (fn [x]
                                                    (and (= (:mostCommonType x) "object")
                                                         (= (path->depth (:path x))
                                                            (inc (+ (path->depth path) describe-table-query-depth))))))
                                          (map :path)
                                          (mapcat nested-fields))]
                          (concat fields nested)))
        fields        (flatten (q! (describe-table-query collection-name sample-size describe-table-query-depth "$ROOT")))
        nested        (->> fields
                           (filter (fn [x]
                                     (and (= (:mostCommonType x) "object")
                                          (= (path->depth (:path x)) describe-table-query-depth))))
                           (map :path)
                           (mapcat nested-fields))]
    (concat fields nested)))

(defn- type-alias->base-type [type-alias]
  ;; Mongo types from $type aggregation operation
  ;; https://www.mongodb.com/docs/manual/reference/operator/aggregation/type/#available-types
  (get {"double"     :type/Float
        "string"     :type/Text
        "object"     :type/Dictionary
        "array"      :type/Array
        "binData"    :type/*
        "objectId"   :type/MongoBSONID
        "bool"       :type/Boolean
        "date"       :type/Instant
        "null"       :type/*
        "regex"      :type/*
        "dbPointer"  :type/*
        "javascript" :type/*
        "symbol"     :type/Text
        "int"        :type/Integer
        "timestamp"  :type/Instant
        "long"       :type/Integer
        "decimal"    :type/Decimal}
        type-alias :type/*))

(defn- add-database-position
  "Adds :database-position to all fields. It starts at 0 and is ordered by a depth-first traversal of nested fields."
  [fields i]
  (->> fields
       (sort-by :sortKey)
       (reduce (fn [[fields i] field]
                 (let [field             (assoc field :database-position i)
                       i                 (inc i)
                       nested-fields     (:nested-fields field)
                       [nested-fields i] (if nested-fields
                                           (add-database-position nested-fields i)
                                           [nested-fields i])
                       field             (-> field
                                             (m/assoc-some :nested-fields nested-fields)
                                             (dissoc :sortKey))]
                   [(conj fields field) i]))
               [#{} i])))

(defmethod driver/describe-table :mongo
  [_driver database table]
  (let [fields (->> (describe-table database table)
                    (map (fn [x]
                           (cond-> {:name              (:k x)
                                    :database-type     (:mostCommonType x)
                                    :base-type         (type-alias->base-type (:mostCommonType x))
                                    ; sortKey is used by `set-database-position`, and not present in final result
                                    :sortKey           (:sortKey x)
                                    ; path and depth are used to nest fields, and not present in final result
                                    :path              (str/split (:path x) #"\.")}
                             (= (:k x) "_id")
                             (assoc :pk? true)))))
        ;; convert the flat list of fields into deeply-nested map.
        ;; `fields` and `:nested-fields` values are maps from name to field
        fields (reduce
                (fn [acc field]
                  (assoc-in acc (interpose :nested-fields (:path field)) (dissoc field :path)))
                {}
                fields)
        ;; replace maps from name to field with sets of fields
        fields (walk/postwalk (fn [x]
                                (cond-> x
                                  (map? x)
                                  (m/update-existing :nested-fields #(set (vals %)))))
                              (set (vals fields)))
        [fields _] (add-database-position fields 0)]
    {:schema nil
     :name   (:name table)
     :fields fields}))

(doseq [[feature supported?] {:basic-aggregations              true
                              :expression-aggregations         true
                              :inner-join                      true
                              :left-join                       true
                              :nested-fields                   true
                              :native-parameter-card-reference false
                              :native-parameters               true
                              :nested-queries                  true
                              :set-timezone                    true
                              :standard-deviation-aggregations true
                              :test/jvm-timezone-setting       false
                              :index-info                      true}]
  (defmethod driver/database-supports? [:mongo feature] [_driver _feature _db] supported?))

(defmethod driver/database-supports? [:mongo :schemas] [_driver _feat _db] false)

(defmethod driver/database-supports? [:mongo :expressions]
  [_driver _feature db]
  (-> ((some-fn :dbms-version :dbms_version) db)
      :semantic-version
      (driver.u/semantic-version-gte [4 2])))

(defmethod driver/database-supports? [:mongo :date-arithmetics]
  [_driver _feature db]
  (-> ((some-fn :dbms-version :dbms_version) db)
      :semantic-version
      (driver.u/semantic-version-gte [5])))

(defmethod driver/database-supports? [:mongo :datetime-diff]
  [_driver _feature db]
  (-> ((some-fn :dbms-version :dbms_version) db)
      :semantic-version
      (driver.u/semantic-version-gte [5])))

(defmethod driver/database-supports? [:mongo :now]
  ;; The $$NOW aggregation expression was introduced in version 4.2.
  [_driver _feature db]
  (-> ((some-fn :dbms-version :dbms_version) db)
      :semantic-version
      (driver.u/semantic-version-gte [4 2])))

(defmethod driver/database-supports? [:mongo :native-requires-specified-collection]
  [_driver _feature _db]
  true)

;; We say Mongo supports foreign keys so that the front end can use implicit
;; joins. In reality, Mongo doesn't support foreign keys.
;; Only define an implementation for `:foreign-keys` if none exists already.
;; In test extensions we define an alternate implementation, and we don't want
;; to stomp over that if it was loaded already.
(when-not (get (methods driver/database-supports?) [:mongo :foreign-keys])
  (defmethod driver/database-supports? [:mongo :foreign-keys] [_driver _feature _db] true))

(defmethod driver/mbql->native :mongo
  [_ query]
  (mongo.qp/mbql->native query))

(defmethod driver/execute-reducible-query :mongo
  [_driver query _context respond]
  (assert (string? (get-in query [:native :collection])) "Cannot execute MongoDB query without a :collection name")
  (mongo.connection/with-mongo-client [_ (lib.metadata/database (qp.store/metadata-provider))]
    (mongo.execute/execute-reducible-query query respond)))

(defmethod driver/substitute-native-parameters :mongo
  [driver inner-query]
  (mongo.params/substitute-native-parameters driver inner-query))

(defmethod driver/db-start-of-week :mongo
  [_]
  :sunday)

(defn- get-id-field-id [table]
  (some (fn [field]
          (when (= (:name field) "_id")
            (:id field)))
        (lib.metadata.protocols/fields (qp.store/metadata-provider) (u/the-id table))))

(defmethod driver/table-rows-sample :mongo
  [_driver table fields rff opts]
  (qp.store/with-metadata-provider (:db_id table)
    (let [mongo-opts {:limit    metadata-queries/nested-field-sample-limit
                      :order-by [[:desc [:field (get-id-field-id table) nil]]]}]
      (metadata-queries/table-rows-sample table fields rff (merge mongo-opts opts)))))

;; Following code is using monger. Leaving it here for a reference as it could be transformed when there is need
;; for ssl experiments.
#_(comment
  (require '[clojure.java.io :as io]
           '[monger.credentials :as mcred])
  (import javax.net.ssl.SSLSocketFactory)

  ;; The following forms help experimenting with the behaviour of Mongo
  ;; servers with different configurations. They can be used to check if
  ;; the environment has been set up correctly (or at least according to
  ;; the expectations), as well as the exceptions thrown in various
  ;; constellations.

  ;; Test connection to Mongo with client and server SSL authentication.
  (let [ssl-socket-factory
        (driver.u/ssl-socket-factory
         :private-key (-> "ssl/mongo/metabase.key" io/resource slurp)
         :password "passw"
         :own-cert (-> "ssl/mongo/metabase.crt" io/resource slurp)
         :trust-cert (-> "ssl/mongo/metaca.crt" io/resource slurp))
        connection-options
        (mg/mongo-options {:ssl-enabled true
                           :ssl-invalid-host-name-allowed false
                           :socket-factory ssl-socket-factory})
        credentials
        (mcred/create "metabase" "admin" "metasample123")]
    (with-open [connection (mg/connect (mg/server-address "127.0.0.1")
                                       connection-options
                                       credentials)]
      (mg/get-db-names connection)))

  ;; Test what happens if the client only support server authentication.
  (let [server-auth-ssl-socket-factory
        (driver.u/ssl-socket-factory
         :trust-cert (-> "ssl/mongo/metaca.crt" io/resource slurp))
        server-auth-connection-options
        (mg/mongo-options {:ssl-enabled true
                           :ssl-invalid-host-name-allowed false
                           :socket-factory server-auth-ssl-socket-factory
                           :server-selection-timeout 200})
        credentials
        (mcred/create "metabase" "admin" "metasample123")]
    (with-open [server-auth-connection
                (mg/connect (mg/server-address "127.0.0.1")
                            server-auth-connection-options
                            credentials)]
      (mg/get-db-names server-auth-connection)))

  ;; Test what happens if the client support only server authentication
  ;; with well known (default) CAs.
  (let [unauthenticated-connection-options
        (mg/mongo-options {:ssl-enabled true
                           :ssl-invalid-host-name-allowed false
                           :socket-factory (SSLSocketFactory/getDefault)
                           :server-selection-timeout 200})
        credentials
        (mcred/create "metabase" "admin" "metasample123")]
    (with-open [unauthenticated-connection
                (mg/connect (mg/server-address "127.0.0.1")
                            unauthenticated-connection-options
                            credentials)]
      (mg/get-db-names unauthenticated-connection)))
  :.)
