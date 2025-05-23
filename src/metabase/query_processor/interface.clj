(ns metabase.query-processor.interface
  "Dynamic variables, constants, and other things used across the query builder namespaces.")
;; TODO - Not 100% sure we really need this namespace since it's almost completely empty these days. Seems like the
;; things here could be moved elsewhere

;; TODO - maybe we should do this more generally with the help of a macro like `do-with-suppressed-output` from the
;; test utils, perhaps implemented as separate middleware (and using a `:middleware` option). Or perhaps even make QP
;; log level an option so you could do debug individual queries
;;
;; TODO - I think we should just remove this entirely, it's not used consistently and it's more trouble than it's
;; worth. Just dial down the log level a bit where we're currently using this
(def ^:dynamic ^Boolean *disable-qp-logging*
  "Should we disable logging for the QP? (e.g., during sync we probably want to turn it off to keep logs less
  cluttered)."
  false)
