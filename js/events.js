(function (app) {
  var listeners = {};

  app.events = {
    on: function (eventName, handler) {
      listeners[eventName] = listeners[eventName] || [];
      listeners[eventName].push(handler);
      return function () {
        listeners[eventName] = (listeners[eventName] || []).filter(function (item) {
          return item !== handler;
        });
      };
    },
    emit: function (eventName, payload) {
      (listeners[eventName] || []).forEach(function (handler) {
        handler(payload);
      });
    }
  };
})(window.DEP = window.DEP || {});
