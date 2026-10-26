// Web config from the Firebase console. The apiKey is meant to be public;
// Realtime Database rules are what limit reads and writes to the round node.
export const firebaseConfig = {
  apiKey: "AIzaSyA660uHUaQVNvwVIsZsDzftkZnf2p_b7vI",
  authDomain: "virtual-golf-league-65c2a.firebaseapp.com",
  databaseURL: "https://virtual-golf-league-65c2a-default-rtdb.firebaseio.com",
  projectId: "virtual-golf-league-65c2a",
  appId: "1:322654838905:web:594e6d7449dd586d6fb4a8",
};

export const firebaseEnabled = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL
);
