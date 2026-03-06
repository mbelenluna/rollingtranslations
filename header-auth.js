/**
 * Header auth — show "Logged in as (name)" and Log out when user is logged in.
 * Hides Register when logged in. Used on main site pages.
 */
import { onAuth, logout } from "./portal/auth.js";

function updateHeader(user) {
  const loginLi = document.getElementById("nav-login-li");
  const registerLi = document.getElementById("nav-register-li");
  const loggedInLi = document.getElementById("nav-logged-in-li");
  const userNameSpan = document.getElementById("nav-user-name");
  const logoutLink = document.getElementById("nav-logout");
  const mobileLogin = document.getElementById("mobile-login");
  const mobileRegister = document.getElementById("mobile-register");
  const mobileLoggedIn = document.getElementById("mobile-logged-in");
  const mobileUserName = document.getElementById("mobile-user-name");
  const mobileLogout = document.getElementById("mobile-logout");

  const name = user?.displayName || user?.email?.split("@")[0] || "User";

  if (user && user.email) {
    if (loginLi) loginLi.style.display = "none";
    if (registerLi) registerLi.style.display = "none";
    if (loggedInLi) {
      loggedInLi.style.display = "";
      if (userNameSpan) userNameSpan.innerHTML = `Logged in<br>as ${name}`;
    }
    if (mobileLogin) mobileLogin.style.display = "none";
    if (mobileRegister) mobileRegister.style.display = "none";
    if (mobileLoggedIn) {
      mobileLoggedIn.style.display = "flex";
      mobileLoggedIn.style.alignItems = "center";
      if (mobileUserName) mobileUserName.innerHTML = `Logged in<br>as ${name}`;
    }
  } else {
    if (loginLi) loginLi.style.display = "";
    if (registerLi) registerLi.style.display = "";
    if (loggedInLi) loggedInLi.style.display = "none";
    if (mobileLogin) mobileLogin.style.display = "";
    if (mobileRegister) mobileRegister.style.display = "";
    if (mobileLoggedIn) mobileLoggedIn.style.display = "none";
  }

  function handleLogout(e) {
    e.preventDefault();
    logout().then(() => {
      if (window.location.pathname.includes("/portal/")) {
        window.location.replace("../");
      } else {
        window.location.reload();
      }
    });
  }

  if (logoutLink) {
    logoutLink.onclick = handleLogout;
  }
  if (mobileLogout) {
    mobileLogout.onclick = handleLogout;
  }
}

onAuth(updateHeader);
