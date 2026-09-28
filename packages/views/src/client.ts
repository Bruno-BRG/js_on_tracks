/**
 * Script do cliente servido pelo `@jot/core` em `/_jot/jot.js`.
 *
 * Sem dependências, JS puro (ES5-friendly) e idempotente. Intercepta o submit de
 * `<form>` com `jot-method` (`post|put|patch|delete`, ou o campo oculto `_method`):
 *
 * - `jot-target="<seletor CSS>"` — alvo do swap. Sem ele (ou sem alvo encontrado),
 *   o formulário segue o fluxo nativo do navegador.
 * - `jot-swap="innerHTML|outerHTML"` — como aplicar a resposta (default `innerHTML`).
 * - `jot-confirm="<mensagem>"` — pede confirmação antes de enviar.
 *
 * A requisição usa o método real, `credentials: "same-origin"` e `FormData`, e
 * dispensa fallback para HTML não-`text/html` (navega para a resposta). Depois de
 * qualquer swap, dispara `jot:load` no `document` para o resto do app reagir.
 */
export const CLIENT_SCRIPT = `/* JOT — jot-* forms (servido em /_jot/jot.js). */
(function () {
  "use strict";

  var JOT_METHODS = { post: true, put: true, patch: true, delete: true };

  function jotMethod(form) {
    var attribute = String(form.getAttribute("jot-method") || "").trim().toLowerCase();
    if (JOT_METHODS[attribute]) return attribute;
    var field = form.querySelector('input[name="_method"]');
    var override = String((field && field.value) || "").trim().toLowerCase();
    return JOT_METHODS[override] ? override : "";
  }

  function jotSwap(target, html, mode) {
    if (mode === "outerhtml") {
      target.outerHTML = html;
    } else {
      target.innerHTML = html;
    }
    document.dispatchEvent(new CustomEvent("jot:load"));
  }

  function jotFallback(form, error) {
    var message = error && error.message ? error.message : String(error);
    console.warn("JOT: could not submit via fetch (" + message + "); falling back to the native form submit.");
    form.submit();
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;

    var method = jotMethod(form);
    if (!method) return;

    var selector = form.getAttribute("jot-target");
    var target = selector ? document.querySelector(selector) : null;
    if (!target) return;

    var confirmMessage = form.getAttribute("jot-confirm");
    if (confirmMessage && !window.confirm(confirmMessage)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    var data = new FormData(form);
    var submitter = event.submitter;
    if (submitter && submitter.name) data.append(submitter.name, submitter.value);
    var tokenField = form.querySelector('input[name="_csrf"]');
    var token = tokenField && typeof tokenField.value === "string" ? tokenField.value : "";
    var headers = {};
    if (token) headers["X-CSRF-Token"] = token;
    var receivedResponse = false;
    var responseStatus = 0;

    fetch(form.action || window.location.href, {
      method: method.toUpperCase(),
      body: data,
      credentials: "same-origin",
      headers: headers
    })
      .then(function (response) {
        receivedResponse = true;
        responseStatus = response.status;
        var type = String(response.headers.get("content-type") || "").toLowerCase();
        if (type && type.indexOf("html") === -1) {
          window.location.href = response.url || window.location.href;
          return null;
        }
        return response.text();
      })
      .then(function (html) {
        if (html !== null) {
          var mode = String(form.getAttribute("jot-swap") || "innerHTML").toLowerCase();
          jotSwap(target, html, mode);
        }
      })
      .catch(function (error) {
        if (receivedResponse && responseStatus === 403) return;
        jotFallback(form, error);
      });
  });
})();
`
