// One click into the live demo: sign in as the read-only guest, then open the dashboard.
// The guest account is public by design. It cannot change anything, never sees the public IP,
// and its session ends after three idle minutes. If sign-in fails the link still opens the normal login.
//
// This page is also served from the bare domain, where the app's API is not. There the button hands
// over to this same page on the app's own host (with #demo), which signs in and opens the dashboard.
(function () {
  var APP = "https://live.homenetwatch.com";
  var buttons = document.querySelectorAll("[data-demo]");
  var status = document.querySelector("[data-demo-status]");
  var onApp = window.location.origin === APP;

  function say(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function enter(event) {
    if (event) event.preventDefault();
    if (!onApp) {
      window.location.assign(APP + "/welcome/#demo");
      return;
    }
    buttons.forEach(function (button) {
      button.setAttribute("aria-busy", "true");
    });
    say("Signing you in as a guest...", false);
    fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "guest", password: "guest" }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("login " + response.status);
        window.location.assign("/");
      })
      .catch(function () {
        buttons.forEach(function (button) {
          button.removeAttribute("aria-busy");
        });
        say("Hmm, the demo sign-in did not work. I will take you to the app: sign in with the username guest and the password guest.", true);
        window.setTimeout(function () {
          window.location.assign("/");
        }, 2500);
      });
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", enter);
  });

  if (onApp && window.location.hash === "#demo") enter();
})();
