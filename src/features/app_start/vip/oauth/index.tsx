import OAuthEmail from './email';

// Self-hosted auth (M4): OAuth popup providers (Google/Yahoo/etc.) are removed.
// Sign-in is email-based — passwordless link/OTP or email + password.
const OAuth = () => {
  return <OAuthEmail />;
};

export default OAuth;
