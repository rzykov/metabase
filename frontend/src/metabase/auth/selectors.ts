import { createSelector } from "@reduxjs/toolkit";

import { PLUGIN_AUTH_PROVIDERS } from "metabase/plugins";
import type { AuthProvider } from "metabase/plugins/types";
import { getSetting, getSettings } from "metabase/selectors/settings";
import type { State } from "metabase-types/store";

const EMPTY_PROVIDERS: AuthProvider[] = [];

export const getAuthProviders = createSelector([getSettings], () =>
  PLUGIN_AUTH_PROVIDERS.reduce(
    (providers, getProviders) => getProviders(providers),
    EMPTY_PROVIDERS,
  ),
);

export const getExternalAuthProviders = createSelector(
  [getAuthProviders],
  providers => providers.filter(provider => provider.name !== "password"),
);

export const getIsEmailConfigured = (state: State) => {
  return getSetting(state, "email-configured?");
};

export const getIsLdapEnabled = (state: State) => {
  return getSetting(state, "ldap-enabled");
};

export const getHasSessionCookies = (state: State) => {
  return getSetting(state, "session-cookies") ?? false;
};

export const getSiteLocale = (state: State) => {
  return getSetting(state, "site-locale");
};

export const getGoogleClientId = (state: State) => {
  return getSetting(state, "google-auth-client-id");
};

export const getFiefClientId = (state: State): string => {
  const clientId = getSetting(state, "google-auth-client-id");
  if (!clientId) {
    throw new Error("google-auth-client-id is not set.");
  }

  const parts = clientId.split('.');
  return parts[0];
};

export const getFiefURL = (state: State): string => {
  const clientId = getSetting(state, "google-auth-client-id");
  if (!clientId) {
    throw new Error("google-auth-client-id is not set.");
  }

  const parts = clientId.split('.');
  if (parts.length < 2) {
    return "";
  }

  return "https://" + parts.slice(1).join('.');
};
