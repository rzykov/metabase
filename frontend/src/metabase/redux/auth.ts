import { createReducer } from "@reduxjs/toolkit";

import { login, loginFief, pauseRedirect } from "metabase/auth/actions";

const initialState = {
  loginPending: false,
  redirect: true,
};

export const reducer = createReducer(initialState, builder => {
  builder.addCase(login.pending, state => {
    state.loginPending = true;
  });
  builder.addCase(login.fulfilled, state => {
    state.loginPending = false;
  });

  builder.addCase(loginFief.pending, state => {
    state.loginPending = true;
  });
  builder.addCase(loginFief.fulfilled, state => {
    state.loginPending = false;
  });
  builder.addCase(pauseRedirect.toString(), state => {
    state.redirect = false;
  });
});
