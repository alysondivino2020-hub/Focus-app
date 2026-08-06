import { initFirebase, firebaseModules } from './firebase-sync.js';

export async function signIn(email, password) {
  const { configured, auth } = await initFirebase();
  if (!configured) throw new Error('Configure o Firebase antes de usar o login.');
  return firebaseModules.signInWithEmailAndPassword(auth, email, password);
}

export async function createAccount(email, password) {
  const { configured, auth } = await initFirebase();
  if (!configured) throw new Error('Configure o Firebase antes de criar uma conta.');
  return firebaseModules.createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle() {
  const { configured, auth } = await initFirebase();
  if (!configured) throw new Error('Configure o Firebase antes de usar o Google.');
  const provider = new firebaseModules.GoogleAuthProvider();
  return firebaseModules.signInWithPopup(auth, provider);
}

export async function recoverPassword(email) {
  const { configured, auth } = await initFirebase();
  if (!configured) throw new Error('Configure o Firebase antes de recuperar a senha.');
  if (!email) throw new Error('Informe seu e-mail.');
  return firebaseModules.sendPasswordResetEmail(auth, email);
}

export async function signOutUser() {
  const { configured, auth } = await initFirebase();
  if (!configured) return;
  return firebaseModules.signOut(auth);
}

export async function observeAuth(callback) {
  const { configured, auth } = await initFirebase();
  if (!configured) {
    callback(null);
    return () => {};
  }
  return firebaseModules.onAuthStateChanged(auth, callback);
}
