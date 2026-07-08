// name kept for upstream-merge compatibility; contains self-hosted implementation, not Firebase

import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import worker from '@services/worker/backupWorker';
import {
  AuthUser,
  currentAuthUser,
  isDeviceAuthenticatedState,
  restoreSession,
} from '@services/auth';

// Self-hosted auth (M4): replaces the Firebase onAuthStateChanged listener.
// On mount we try to restore a session from the httpOnly visitorid cookie; the
// reactive isDeviceAuthenticatedState atom then tracks login/logout thereafter.
const useFirebaseAuth = () => {
  const isAuthenticated = useAtomValue(isDeviceAuthenticatedState);
  const [user, setUser] = useState<AuthUser | undefined>(currentAuthUser());

  useEffect(() => {
    const init = async () => {
      try {
        const restored = currentAuthUser() ?? (await restoreSession());
        setUser(restored);

        if (restored) {
          worker.postMessage({
            field: 'idToken',
            value: await restored.getIdToken(),
          });
        }
      } catch (error) {
        console.error(error);
      }
    };

    init();
  }, []);

  return { isAuthenticated, user };
};

export default useFirebaseAuth;
