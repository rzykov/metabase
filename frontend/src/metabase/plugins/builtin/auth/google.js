import GoogleSettingsForm from "metabase/admin/settings/auth/containers/GoogleAuthForm";
import MetabaseSettings from "metabase/lib/settings";
import {
  PLUGIN_ADMIN_SETTINGS_UPDATES,
  PLUGIN_AUTH_PROVIDERS,
  PLUGIN_IS_PASSWORD_USER,
} from "metabase/plugins";

PLUGIN_AUTH_PROVIDERS.providers.push((providers) => {
  const googleProvider = {
    name: "google",
    // circular dependencies
    Button: require("metabase/auth/components/GoogleButton").GoogleButton,
  };

  return MetabaseSettings.isGoogleAuthEnabled()
    ? [googleProvider, ...providers]
    : providers;
});

PLUGIN_ADMIN_SETTINGS_UPDATES.push((sections) => ({
  ...sections,
  "authentication/google": {
    component: GoogleSettingsForm,
    settings: [
      { key: "google-auth-client-id" },
      { key: "google-auth-auto-create-accounts-domain" },
    ],
  },
}));

PLUGIN_IS_PASSWORD_USER.push((user) => user.sso_source !== "google");
