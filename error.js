

window.addEventListener('error', (event) => {
  const el = document.getElementById("error-display");
  el.style.visibility = "visible";

  if (event.target !== window) {
    // Resource Error
    const tagName = event.target.tagName;
    let resourceUrl = "";

    if (tagName === "IMG" || tagName === "SCRIPT") {
      resourceUrl = event.target.src;
    } else if (tagName === "LINK") {
      resourceUrl = event.target.href;
    } else {
      resourceUrl = "(unknown resource URL)";
    }

    el.innerHTML += `
      <p style="color:red;">
        Resource load error: &lt;${tagName}&gt;<br>
        URL: ${resourceUrl}
      </p>
    `;
  } else {
    // Runtime Error
    const filename = event.filename || "(no filename)";
    const lineno   = event.lineno   || "(no line)";
    const colno    = event.colno    || "(no column)";
    const message  = event.message  || "(no message)";

    el.innerHTML += `
      <p style="color:red;">
        <strong>Message:</strong> ${message}<br>
        <strong>File:</strong> ${filename}<br>
        <strong>Line:</strong> ${lineno}:${colno}
      </p>
    `;
  }
}, true);


// Errors in Promise
window.addEventListener('unhandledrejection', (event) => {
  const el = document.getElementById("error-display");
  el.style.visibility = "visible";
  el.innerHTML += `<p style="color:red;">Unhandled Promise Error: ${event.reason}</p>`;
});


// for WebGL Errors
(function() {
  const originalError = console.error;
  console.error = function(...args) {
    originalError.apply(console, args);

    const el = document.getElementById("error-display");
    if (el) {
      el.style.visibility = "visible";
      const msg = args.map(a => String(a)).join(" ");
      el.innerHTML += `<p style="color:red;">[console.error] ${msg}</p>`;
    }
  };
})();