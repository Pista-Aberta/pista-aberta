const API = import.meta.env.VITE_API_URL ?? "";

/**
 * Login SAML mock nun clic (barra da demo).
 * REVISION-27 E2: POST directo ao SSO (auto-submit en DOMContentLoaded),
 * sen pasar polo selector «Elixe quen es».
 */
export function demoSamlLoginAs(userKey: string, relayState: string): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${API}/auth/saml/mock-idp/sso?auto=1`;
  form.style.display = "none";

  const user = document.createElement("input");
  user.type = "hidden";
  user.name = "user";
  user.value = userKey;
  form.appendChild(user);

  const relay = document.createElement("input");
  relay.type = "hidden";
  relay.name = "RelayState";
  relay.value = relayState;
  form.appendChild(relay);

  document.body.appendChild(form);
  form.submit();
}
