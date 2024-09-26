// FiefButton.tsx

import React, { useCallback, useEffect, useState, ReactNode } from "react";
import { t } from "ttag";
import { FiefAuthProvider, useFiefAuth } from "@fief/fief/react";
import { useDispatch } from "metabase/lib/redux";
import { loginGoogle } from "../../actions"; // Use loginGoogle as it was
import {
  GoogleButtonRoot,
  AuthErrorRoot,
  AuthError,
  TextLink,
} from "./GoogleButton.styled"; // Styling imports

interface FiefButtonProps {
  redirectUrl?: string;
  isCard?: boolean;
  onSuccess?: (accessToken: string, userinfo: any) => void;
  onError?: (error: Error) => void;
}

interface CustomFiefAuthProviderProps {
  baseURL: string;
  clientId: string;
  onSuccess: (accessToken: string, userinfo: any) => void;
  onError?: (error: Error) => void;
  redirectUrl: string;
  children: (props: { handleLoginRedirect: () => Promise<void> }) => ReactNode;
}

// Wrapper to add support for onSuccess and onError
const CustomFiefAuthProvider: React.FC<CustomFiefAuthProviderProps> = ({
  baseURL,
  clientId,
  onSuccess,
  onError,
  redirectUrl,
  children,
}) => {
  return (
    <FiefAuthProvider baseURL={baseURL} clientId={clientId}>
      <InnerFiefComponent
        onSuccess={onSuccess}
        onError={onError}
        redirectUrl={redirectUrl}
        children={children}
      />
    </FiefAuthProvider>
  );
};

const InnerFiefComponent: React.FC<{
  onSuccess: (accessToken: string, userinfo: any) => void;
  onError?: (error: Error) => void;
  redirectUrl: string;
  children: (props: { handleLoginRedirect: () => Promise<void> }) => ReactNode;
}> = ({ onSuccess, onError, redirectUrl, children }) => {
  const fiefAuth = useFiefAuth();
  const [error, setError] = useState<Error | null>(null);
  const [isAuthCallbackProcessed, setIsAuthCallbackProcessed] = useState(false);

  const handleLoginRedirect = useCallback(async () => {
    try {
      console.log("Redirecting to Fief login...");
      // Line left unchanged as per your request
      await fiefAuth.redirectToLogin(`${window.location.origin}/auth/login`);
    } catch (err) {
      setError(err as Error);
      if (onError) onError(err as Error);
    }
  }, [fiefAuth, onError]);

 useEffect(() => {
  console.log("useEffect triggered");
  console.log("window.location.search:", window.location.search);
  console.log("Contains 'code=':", window.location.search.includes("code="));
  console.log("isAuthCallbackProcessed:", isAuthCallbackProcessed);

  const handleAuthCallback = async () => {
    if (isAuthCallbackProcessed) {
      console.log("Auth callback already processed. Exiting.");
      return;
    }

    console.log("handleAuthCallback started");

    try {
      await fiefAuth.authCallback(`${window.location.origin}/auth/login`);
      console.log("authCallback completed");
      setIsAuthCallbackProcessed(true);

      const tokenInfo = fiefAuth.getTokenInfo();
      const userinfo = fiefAuth.getUserinfo();

      console.log("Token Info:", tokenInfo);
      console.log("User Info:", userinfo);

      if (tokenInfo && userinfo) {
        onSuccess(tokenInfo.access_token, userinfo);
      } else {
        console.error("Failed to retrieve token info or user info.");
        throw new Error("Failed to retrieve token info or user info.");
      }
    } catch (err) {
      console.error("Error during authCallback:", err);
      setError(err as Error);
      if (onError) onError(err as Error);
    }
  };

  if (window.location.search.includes("code=")) {
    console.log("'code' parameter found in URL. Starting auth callback.");
    handleAuthCallback();
  } else {
    console.log("No 'code' parameter in URL. Auth callback not started.");
  }
}, [fiefAuth, onSuccess, onError, isAuthCallbackProcessed]);

  return <>{children({ handleLoginRedirect })}</>;
};

// FiefButton component to handle login
export const FiefButton: React.FC<FiefButtonProps> = ({
  redirectUrl = `${window.location.origin}/auth/login`,
  isCard = true,
  onSuccess,
  onError,
}) => {
  const [errors, setErrors] = useState<string[]>([]);
  const dispatch = useDispatch();

  const memoizedOnSuccess = useCallback(
    (accessToken: string, userinfo: any) => {
      console.log("Login successful, access token:", accessToken);
      setErrors([]);
      if (onSuccess) onSuccess(accessToken, userinfo);
      // Dispatch your Redux action here:
      dispatch(loginGoogle({ accessToken, redirectUrl })).unwrap();
    },
    [dispatch, onSuccess]
  );

  const memoizedOnError = useCallback(
    (error: Error) => {
      console.error("Login error:", error);
      setErrors([error.message]);
      if (onError) onError(error);
    },
    [onError]
  );

  // Fief login button to trigger login process
  const FiefLoginButton = ({
    handleLoginRedirect,
  }: {
    handleLoginRedirect: () => Promise<void>;
  }) => {
    const handleClick = async () => {
      try {
        await handleLoginRedirect(); // Trigger the login redirect
      } catch (error) {
        console.error("Error during login", error); // Log any errors
      }
    };

    return (
      <button onClick={handleClick}>
        {t`Sign in with Fief`} {/* Button text for Fief login */}
      </button>
    );
  };

  return (
    <GoogleButtonRoot>
      {isCard ? (
        <CustomFiefAuthProvider
          baseURL="https://auth.retenly.com"
          clientId="N2URtkpBDdugSVjE5GYZGgGSTYumLmPUCl49GKj1AdQ"
          onSuccess={memoizedOnSuccess}
          onError={memoizedOnError}
          redirectUrl={redirectUrl}
        >
          {({ handleLoginRedirect }) => (
            <FiefLoginButton handleLoginRedirect={handleLoginRedirect} />
          )}
        </CustomFiefAuthProvider>
      ) : (
        <TextLink to={redirectUrl}>{t`Sign in with Fief`}</TextLink> // Fallback link
      )}

      {errors.length > 0 && (
        <AuthErrorRoot>
          {errors.map((error, index) => (
            <AuthError key={index}>{error}</AuthError> // Display each error
          ))}
        </AuthErrorRoot>
      )}
    </GoogleButtonRoot>
  );
};
