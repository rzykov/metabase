import React, { useEffect, useState } from "react";
import { t } from "ttag";
import { FiefAuthProvider, useFiefAuth, useFiefTokenInfo } from "@fief/fief/react";
import { useDispatch, useSelector } from "metabase/lib/redux";
import { loginFief } from "../../actions";
import { getFiefClientId, getFiefURL } from "../../selectors";
import MetabaseSettings from "metabase/lib/settings";

import {
  GoogleButtonRoot,
  AuthErrorRoot,
  AuthError,
  TextLink,
} from "./GoogleButton.styled";

import styled from "@emotion/styled";

export const ButtonLink = styled.button`
  cursor: pointer;
  color: var(--mb-color-text-dark);
  background-color: var(--mb-color-background-light); /* Add background */
  border: 2px solid var(--mb-color-border); /* Add border */
  border-radius: 8px; /* Optional: Add rounded corners */
  padding: 12px 24px;
  font: inherit;
  font-size: 1rem;
  line-height: 1.5;

  &:hover {
    color: var(--mb-color-brand);
    background-color: var(--mb-color-background-hover); /* Change background on hover */
    border-color: var(--mb-color-border-hover); /* Change border on hover */
  }
`;


interface FiefButtonProps {
  redirectUrl?: string;
  isCard?: boolean;
  onSuccess?: (accessToken: string) => void;
  onError?: (error: Error) => void;
}

export const FiefButton: React.FC<FiefButtonProps> = ({
  redirectUrl = `${window.location.origin}`,
  isCard = true,
  onSuccess,
  onError,
}) => {
  const clientId = useSelector(getFiefClientId);
  const fiefUrl = useSelector(getFiefURL);
  const [errors, setErrors] = useState<string[]>([]);
  const dispatch = useDispatch();

  return (
    <FiefAuthProvider baseURL={fiefUrl} clientId={clientId}>
      <FiefButtonContent
        redirectUrl={redirectUrl}
        isCard={isCard}
        onSuccess={onSuccess}
        onError={onError}
        dispatch={dispatch}
        errors={errors}
        setErrors={setErrors}
      />
    </FiefAuthProvider>
  );
};

interface FiefButtonContentProps {
  redirectUrl: string;
  isCard: boolean;
  onSuccess?: (accessToken: string) => void;
  onError?: (error: Error) => void;
  dispatch: any;
  errors: string[];
  setErrors: React.Dispatch<React.SetStateAction<string[]>>;
}

const FiefButtonContent: React.FC<FiefButtonContentProps> = ({
  redirectUrl,
  isCard,
  onSuccess,
  onError,
  dispatch,
  errors,
  setErrors,
}) => {
  const fiefAuth = useFiefAuth();
  const tokenInfo = useFiefTokenInfo(); // Use the hook to get token info

  const handleLoginRedirect = async () => {
    try {
      console.log("Redirecting to Fief login...");
      await fiefAuth.redirectToLogin(`${MetabaseSettings.get("site-url")}/auth/login`);
    } catch (err) {
      console.error("Error during redirectToLogin:", err);
      setErrors(prev => [...prev, err.message || 'Redirect error']);
      if (onError) onError(err as Error);
    }
  };

  useEffect(() => {
    const handleAuthCallback = async () => {
      if (!window.location.search.includes("code=")) {
        console.log("No 'code' parameter in URL. Auth callback not started.");
        return;
      }

      console.log("handleAuthCallback started");

      try {
        await fiefAuth.authCallback(`${MetabaseSettings.get("site-url")}/auth/login`);
        console.log("authCallback completed");
        // Remove the code parameter from the URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        console.error("Error during authCallback:", err);
        if (onError) onError(err as Error);
      }
    };

    handleAuthCallback();
  }, [fiefAuth, onError]);

  // Use another useEffect to act when tokenInfo becomes available
  useEffect(() => {
    if (tokenInfo) {
      console.log("Token Info:", tokenInfo);
      console.log("Login successful, access token:", tokenInfo.access_token);
      setErrors([]);
      if (onSuccess) onSuccess(tokenInfo.access_token);
      dispatch(loginFief({ accessToken: tokenInfo.access_token, redirectUrl })).unwrap();
    }
  }, [tokenInfo, onSuccess, dispatch, redirectUrl]);

  const FiefLoginButton = () => {
    const handleClick = async () => {
      try {
        await handleLoginRedirect();
      } catch (error) {
        console.error("Error during login", error);
      }
    };

    return (
      <ButtonLink onClick={handleClick}>
        {t`Sign In / Sign Up`}
      </ButtonLink>
    );
  };

  return (
    <GoogleButtonRoot>
      {isCard ? (
        <FiefLoginButton />
      ) : (
        <TextLink to={redirectUrl}>{t`Sign In / Sign Up`}</TextLink>
      )}

      {errors.length > 0 && (
        <AuthErrorRoot>
          {errors.map((error, index) => (
            <AuthError key={index}>{error}</AuthError>
          ))}
        </AuthErrorRoot>
      )}
    </GoogleButtonRoot>
  );
};
