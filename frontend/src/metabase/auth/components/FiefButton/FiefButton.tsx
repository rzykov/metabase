import React, { useEffect, useState, useRef } from "react";
import { t } from "ttag";
import { FiefAuthProvider, useFiefAuth, useFiefTokenInfo } from "@fief/fief/react";
import { useDispatch, useSelector } from "metabase/lib/redux";
import { loginFief } from "../../actions";
import { getFiefClientId, getFiefURL } from "../../selectors";

import {
  GoogleButtonRoot,
  AuthErrorRoot,
  AuthError,
  TextLink,
  ButtonLink,
} from "./GoogleButton.styled";

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
  const tokenInfo = useFiefTokenInfo();
  const [redirectUrlFromState, setRedirectUrlFromState] = useState<string>(redirectUrl);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [countdown, setCountdown] = useState<number>(5);
  const [isInitialState, setIsInitialState] = useState<boolean>(true);

  const handleLoginRedirect = async () => {
    try {
      console.log("Redirecting to Fief login...");
      await fiefAuth.redirectToLogin(`${window.location.origin}/auth/login`, {
        state: redirectUrl,
      });
    } catch (err) {
      console.error("Error during redirectToLogin:", err);
      if (onError) onError(err as Error);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("code")) {
      setIsInitialState(false);
    }
  }, []);

  useEffect(() => {
    if (!isInitialState) return;

    const timer = setInterval(() => {
      setCountdown((prevCountdown) => {
        if (prevCountdown <= 1) {
          clearInterval(timer);
          if (buttonRef.current) {
            buttonRef.current.click();
          }
          return 0;
        }
        return prevCountdown - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isInitialState]);

  useEffect(() => {
    const handleAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has("code")) {
        return;
      }

      console.log("handleAuthCallback started");

      try {
        const stateParam = urlParams.get("state");
        const redirectUrlFromState = stateParam || redirectUrl;
        setRedirectUrlFromState(redirectUrlFromState);

        await fiefAuth.authCallback(`${window.location.origin}/auth/login`);

        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        console.error("Error during authCallback:", err);
        if (onError) onError(err as Error);
      }
    };

    handleAuthCallback();
  }, [fiefAuth, onError, redirectUrl]);

  useEffect(() => {
    const handleLoginFief = async () => {
      if (tokenInfo) {
        setErrors([]);
        if (onSuccess) onSuccess(tokenInfo.access_token);
        try {
          await dispatch(
            loginFief({ accessToken: tokenInfo.access_token, redirectUrl: redirectUrlFromState }),
          ).unwrap();

          window.location.href = redirectUrlFromState;
        } catch (err) {
          console.error("Error during loginFief:", err);
          if (onError) onError(err as Error);
        }
      }
    };

    handleLoginFief();
  }, [tokenInfo, onSuccess, dispatch, redirectUrlFromState]);

  const FiefLoginButton = () => {
    return (
      <ButtonLink onClick={handleLoginRedirect} ref={buttonRef}>
        {t`Sign In / Sign Up`}
      </ButtonLink>
    );
  };

  return (
    <GoogleButtonRoot>
      {isCard ? (
        <>
          <FiefLoginButton />
          {isInitialState && <p>You will be redirected in {countdown} seconds</p>}
        </>
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
