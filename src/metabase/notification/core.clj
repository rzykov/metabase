(ns metabase.notification.core
  "Notifications do:
  - execute notificatino based on its type
  - deliver the message to all of its channel"
  (:require
   [metabase.events :as events]
   [metabase.channel.core :as channel]
   [metabase.notification.execute :as noti.execute]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [metabase.util.ui-logic :as ui-logic]
   [toucan2.core :as t2]))

(def ^:private Notification
  [:map
   [:payload_type [:enum :notification/alert :notification/dashboard-subscription]]
   [:payload_id   pos-int?]
   [:creator_id   pos-int?]])

(def ^:private PayloadInfo
  [:merge
   Notification
   [:multi {:dispatch :payload_type}
    [:notification/alert [:map
                          ;; should be model/Alert in the future
                          [:alert [:and (ms/InstanceOf :model/Pulse)
                                   [:map [:card_id pos-int?]]]]]]
    [:notification/dashboard-subscription [:map
                                           ;; should be model/DashboardSubscription in the future
                                           [:dashboard-subscription [:and (ms/InstanceOf :model/Pulse)
                                                                     [:map
                                                                      [:dashboard_id pos-int?]
                                                                      [:cards [:sequential :map]]
                                                                      [:creator :map]]]]]]]])

(def ^:private AlertPayload
  [:map {:closed true}
   [:payload-type [:= :notification/alert]]
   [:alert        :map]
   [:card         :map]
   [:result       :map]])

(def ^:private DashboardSubscriptionPayload
  [:notification/dashboard-subscription [:map {:closed true}
                                          [:payload-type           [:= :notification/dashboard-subscription]]
                                          [:dashboard              :map]
                                          [:dashboard-subscription :map]
                                          [:result                 [:sequential :map]]]])

(defn notification->channel+recipients
  [notification pc-ids]
  (let [pcs (if (some? pc-ids)
              (t2/select :model/PulseChannel :pulse_id (:payload_id notification)
                         :enabled true
                         :id [:in pc-ids])
              (t2/select :model/PulseChannel :pulse_id (:payload_id notification) :enabled true))]
    (for [pc pcs]
      (let [channel-type (keyword "channel" (name (:channel_type pc)))]
        {:channel_type channel-type
         :recipients   (if (= :channel/email channel-type)
                         (concat (map (fn [user]
                                        {:kind :user
                                         :user user})
                                      ;; TODO: n+1 here
                                      (t2/select :model/User
                                                 {:left-join [[:pulse_channel_recipient :pcr] [:= :core_user.id :pcr.user_id]
                                                              [:pulse_channel :pc] [:= :pc.id :pcr.pulse_channel_id]
                                                              [:pulse :p] [:= :p.id :pc.pulse_id]]
                                                  :where     [:and
                                                              [:= :p.id (:payload_id notification)]
                                                              [:= :core_user.is_active true]]
                                                  :order-by [[:core_user.id :asc]]}))
                                 ;; non-user-email
                                 (map (fn [email] {:recipient email
                                                   :kind      :external-email}) (get-in pc [:recipients :emails])))
                         [{:kind      :slack-channel
                           :recipient (get-in pc [:details :channel])}])}))))

;; ------------------------------------------------------------------------------------------------;;
;;                                        Multimethods                                             ;;
;; ------------------------------------------------------------------------------------------------;;

(defmulti ^:private execute-payload
  "Turn a notification into a payload that can be sent to a channel"
  :payload_type)

(defmulti notification->payload-info
  :payload_type)

(defmulti ^:private should-send-notification?
  "Returns true if given the pulse type and resultset a new notification (pulse or alert) should be sent"
  (fn [payload-info _payload] (:payload_type payload-info)))

(defmethod ^:private should-send-notification? :default
  [_payload-info _payload]
  true)

;; ------------------------------------------------------------------------------------------------;;
;;                                           Alerts                                                ;;
;; ------------------------------------------------------------------------------------------------;;

(mu/defmethod notification->payload-info :notification/alert :- PayloadInfo
  [notification :- Notification]
  (let [alert (assoc (t2/hydrate (t2/select-one :model/Pulse (:payload_id notification)) :creator)
                     :card_id
                     (t2/select-one-fn :card_id :model/PulseCard :pulse_id (:payload_id notification)))]
    (assoc notification :alert alert)))

(mu/defmethod execute-payload :notification/alert :- AlertPayload
  [payload-info :- PayloadInfo]
  (let [card (t2/select-one :model/Card :id (get-in payload-info [:alert :card_id]) :archived false)]
    {:payload-type :notification/alert
     :card         card
     :alert        (:alert payload-info)
     :result       (noti.execute/execute-card (:creator_id payload-info) card)}))

(defn- is-card-empty?
  "Check if the card is empty"
  [card]
  (if-let [result (:result card)]
    (or (zero? (-> result :row_count))
        ;; Many aggregations result in [[nil]] if there are no rows to aggregate after filters
        (= [[nil]]
           (-> result :data :rows)))
    ;; Text cards have no result; treat as empty
    true))

(defn- are-all-parts-empty?
  "Do none of the cards have any results?"
  [results]
  (every? is-card-empty? results))

(defn- goal-met? [{:keys [alert_above_goal], :as pulse} [first-result]]
  (let [goal-comparison      (if alert_above_goal >= <)
        goal-val             (ui-logic/find-goal-value first-result)
        comparison-col-rowfn (ui-logic/make-goal-comparison-rowfn (:card first-result)
                                                            (get-in first-result [:result :data]))]

    (when-not (and goal-val comparison-col-rowfn)
      (throw (ex-info (tru "Unable to compare results to goal for alert.")
                      {:pulse  pulse
                       :result first-result})))
    (boolean
     (some (fn [row]
             (goal-comparison (comparison-col-rowfn row) goal-val))
           (get-in first-result [:result :data :rows])))))

(defmethod should-send-notification? :notification/alert
  [payload-info payload]
  (let [alert           (:alert payload-info)
        alert-condition (:alert_condition alert)]
    (cond
      (= "rows" alert-condition)
      (not (is-card-empty? payload))

      (= "goal" alert-condition)
      (goal-met? alert payload)

      :else
      (let [^String error-text (tru "Unrecognized alert with condition ''{0}''" alert-condition)]
        (throw (IllegalArgumentException. error-text))))))

;; ------------------------------------------------------------------------------------------------;;
;;                                    Dashboard Subscriptions                                      ;;
;; ------------------------------------------------------------------------------------------------;;

(defmethod should-send-notification? :notification/dashboard-subscription
  [payload-info payload]
  (if (:skip_if_empty (:dashboard-subscription payload-info))
    (not (are-all-parts-empty? payload))
    true))

(mu/defmethod notification->payload-info :notification/dashboard-subscription :- PayloadInfo
  [notification :- Notification]
  (let [dashboard-subscription (t2/hydrate (t2/select-one :model/Pulse (:payload_id notification)) :cards :creator)]
    (assoc notification :dashboard-subscription dashboard-subscription)))


(mu/defmethod execute-payload :notification/dashboard-subscription :- DashboardSubscriptionPayload
  [{:keys [dashboard-subscription creator_id]} :- PayloadInfo]
  {:payload-type           :notification/dashboard-subscription
   :dashboard-subscription dashboard-subscription
   :dashboard              (t2/select-one :model/Dashboard (:dashboard_id dashboard-subscription))
   :result                 (noti.execute/execute-dashboard creator_id dashboard-subscription)})
;; ------------------------------------------------------------------------------------------------;;
;;                                        Public Interface                                         ;;
;; ------------------------------------------------------------------------------------------------;;

(def payload-type->event-type
  {:notification/alert                  :event/alert-send
   :notification/dashboard-subscription :event/subscription-send})

(mu/defn send-notification!
  "Send the notification."
  ([notification :- Notification]
   (send-notification!
    (notification->payload-info notification)
    (notification->channel+recipients notification nil)))
  ([payload-info :- PayloadInfo
    channel+recipients]
   (let [payload                (execute-payload payload-info)
         payload-type           (:payload_type payload-info)
         notification-info      (if (= :notification/alert payload-type)
                                  (:alert payload-info)
                                  (:dashboard-subscription payload-info))]
    (if (should-send-notification? payload-info payload)
      (do
       (events/publish-event! (get payload-type->event-type payload-type)
                              {:id      (:payload_id payload-info)
                               :user-id (:creator_id payload-info)
                               :object  {:recipients (map :recipients channel+recipients)
                                         :filters    (:parameters notification-info)}})
       (when (and (= :notification/alert payload-type) (:alert_first_only notification-info))
             (t2/delete! :model/Pulse (:id notification-info)))
       (doseq [channel channel+recipients]
         (let [channel-details {:channel_type (:channel_type channel)}]
           (log/infof "Sending notification %d to channel: %s" (:payload_id payload-info) channel)
           (doseq [message (channel/render-notification channel-details
                                                        payload
                                                        (:recipients channel)
                                                        nil)]
             (channel/send! channel-details message)))))
      (log/infof "Skipping notification %s" (select-keys payload-info [:payload_id :payload_type]))))))

(comment
 (def alert-id 14)
 (def crowberto-id (t2/select-one-pk :model/User :email "crowberto@metabase.com"))

 #_(ngoc/with-tc
     (execute-payload (notification->payload-info {:payload_type :alert
                                                   :payload_id   alert-id
                                                   :creator_id   crowberto-id})))


 (ngoc/with-tc
   (send-notification! {:payload_type :alert
                        :payload_id   alert-id
                        :creator_id   crowberto-id})))

(comment
 (def dash-sub-id 16)

 (def payload (execute-payload (notification->payload-info {:payload_type :dashboard-subscription
                                                            :payload_id   dash-sub-id
                                                            :creator_id   crowberto-id})))

 (ngoc/with-tc
   (send-notification! {:payload_type :dashboard-subscription
                        :payload_id   dash-sub-id
                        :creator_id   crowberto-id})))
