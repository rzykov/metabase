import styled from "@emotion/styled";

import Link from "metabase/core/components/Link";

export const GoogleButtonRoot = styled.div`
  display: flex;
  justify-content: center;
  flex-flow: column wrap;
  align-items: center;
`;

export const AuthError = styled.div`
  color: var(--mb-color-error);
  text-align: center;
`;

export const AuthErrorRoot = styled.div`
  margin-top: 1rem;
`;

export const TextLink = styled(Link)`
  cursor: pointer;
  color: var(--mb-color-text-dark);

  &:hover {
    color: var(--mb-color-brand);
  }
`;

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
