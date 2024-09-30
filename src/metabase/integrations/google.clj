(ns metabase.integrations.google
  (:require
   [cheshire.core :as json]
   [clj-http.client :as http]
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.config :as config]
   [metabase.integrations.google.interface :as google.i]
   [metabase.models.setting :as setting :refer [defsetting]]
   [metabase.models.setting.multi-setting
    :refer [define-multi-setting-impl]]
   [metabase.models.user :as user :refer [User]]
   [metabase.plugins.classloader :as classloader]
   [metabase.util :as u]
   [metabase.util.i18n :refer [deferred-tru tru]]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [toucan2.core :as t2]))

;; Load EE implementation if available
(when config/ee-available?
  (classloader/require 'metabase-enterprise.enhancements.integrations.google))

(def ^:private non-existant-account-message
  (deferred-tru "You'll need an administrator to create a Metabase account before you can use Google to log in."))

(defsetting google-auth-client-id
  (deferred-tru "Client ID for Google Sign-In.")
  :visibility :public
  :audit      :getter
  :setter     (fn [client-id]
                (if (seq client-id)
                  (let [trimmed-client-id (str/trim client-id)]
                    ;; Adjust validation to match Fief's client ID pattern if necessary
                    ;; (when-not (str/ends-with? trimmed-client-id ".auth.retenly.com")
                    ;;   (throw (ex-info (tru "Invalid Fief Sign-In Client ID: must end with \".auth.retenly.com\"")
                    ;;                   {:status-code 400})))
                    (setting/set-value-of-type! :string :google-auth-client-id trimmed-client-id))
                  (do
                    (setting/set-value-of-type! :string :google-auth-client-id nil)
                    (setting/set-value-of-type! :boolean :google-auth-enabled false)))))

(defsetting google-auth-configured
  (deferred-tru "Is Google Sign-In configured?")
  :type   :boolean
  :setter :none
  :getter (fn [] (boolean (google-auth-client-id))))

(defsetting google-auth-enabled
  (deferred-tru "Is Google Sign-in currently enabled?")
  :visibility :public
  :type       :boolean
  :audit      :getter
  :getter     (fn []
                (if-some [value (setting/get-value-of-type :boolean :google-auth-enabled)]
                  value
                  (boolean (google-auth-client-id))))
  :setter     (fn [new-value]
                (if-let [new-value (boolean new-value)]
                  (if-not (google-auth-client-id)
                    (throw (ex-info (tru "Google Sign-In is not configured. Please set the Client ID first.")
                                    {:status-code 400}))
                    (setting/set-value-of-type! :boolean :google-auth-enabled new-value))
                  (setting/set-value-of-type! :boolean :google-auth-enabled new-value))))

(define-multi-setting-impl google.i/google-auth-auto-create-accounts-domain :oss
  :getter (fn [] (setting/get-value-of-type :string :google-auth-auto-create-accounts-domain))
  :setter (fn [domain]
            (when (and domain (str/includes? domain ","))
              ;; Multiple comma-separated domains requires the `:sso-google` premium feature flag
              (throw (ex-info (tru "Invalid domain") {:status-code 400})))
            (setting/set-value-of-type! :string :google-auth-auto-create-accounts-domain domain)))

(def ^:private fief-userinfo-url "https://auth.retenly.com/api/userinfo")

(defn- get-userinfo [access-token]
  (let [response (http/get fief-userinfo-url
                           {:headers {"Authorization" (str "Bearer " access-token)
                                      "accept" "application/json"}
                            :as :json
                            :throw-exceptions false})]
    (if (= 200 (:status response))
      (:body response)
      (throw (ex-info "Failed to retrieve user info from Fief"
                      {:status-code (:status response)
                       :error (:body response)})))))

(defn- google-auth-token-info
  "Process the token information received from Fief (acting as Google Auth)."
  [access-token]
  (get-userinfo access-token))

(defn- autocreate-user-allowed-for-email? [email]
  true) ;; Always allow auto-creation

(mu/defn ^:private google-auth-create-new-user!
  [{:keys [email] :as new-user} :- user/NewUser]
  (autocreate-user-allowed-for-email? email)
  ;; Create a new user with the provided information
  (user/create-new-google-auth-user! new-user))

(defn- maybe-update-google-user!
  "Update user if the first or last name changed."
  [user first-name last-name]
  (when (or (not= first-name (:first_name user))
            (not= last-name (:last_name user)))
    (t2/update! :model/User (:id user) {:first_name first-name
                                        :last_name  last-name}))
  (assoc user :first_name first-name :last_name last-name))

(mu/defn ^:private google-auth-fetch-or-create-user! :- (ms/InstanceOf User)
  [first-name last-name email]
  (let [existing-user (t2/select-one [User :id :email :last_login :first_name :last_name]
                                     :%lower.email (u/lower-case-en email))]
    (if existing-user
      (maybe-update-google-user! existing-user first-name last-name)
      (google-auth-create-new-user! {:first_name first-name
                                     :last_name  last-name
                                     :email      email}))))

(defn do-google-auth
  "Handle authentication via Fief using existing Google auth function names."
  [{{:keys [token]} :body}]
  (log/infof "Got token: %s" token)
  (let [access-token token
        token-info   (google-auth-token-info access-token)
        {:keys [given_name family_name email email_verified]} token-info]
    (when-not email_verified
      (throw (ex-info "Email is not verified." {:status-code 400})))
    (log/infof "Successfully authenticated Fief token for: %s %s" given_name family_name)
    (api/check-500 (google-auth-fetch-or-create-user! given_name family_name email))))
