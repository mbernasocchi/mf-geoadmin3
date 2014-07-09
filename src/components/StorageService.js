(function() {
  goog.provide('ga_storage_service');

  goog.require('ga_browsersniffer_service');

  var module = angular.module('ga_storage_service', [
    'ga_browsersniffer_service'
  ]);

  /**
   * Service provides read/write/delete functions in local storages.
   *
   * There is 2 sets (get/set/remove) of functions:
   *   - one for tiles management. These functions use the mozilla localforage
   *   library (see http://github.com/mozilla/localForage). We use this library
   *   to get the maximum advantages of last HTML 5 offline storage features
   *   (indexedDb, webSQL, localStorage, FileAPI). See the api doc for more
   *   information http://mozilla.github.io/localForage/.
   *
   *   - one for basic localStorage. These functions are used to store simple
   *   string (homescreen popup, offline data informations).
   *
   */
  module.provider('gaStorage', function() {
    this.$get = function(gaBrowserSniffer) {

      // The if statement is only here to avoid errors in tests
      if (window.localforage) {
        window.localforage.config({
          name: 'map.geo.admin.ch',
          storeName: 'ga',
          version: (gaBrowserSniffer.msie) ? 1 : '1.0',
          description: 'Storage for map.geo.admin.ch'
        });
      }

      var Storage = function() {

        // Strings management
        this.getItem = function(key) {
          return window.localStorage.getItem(key);
        };
        this.setItem = function(key, data) {
          window.localStorage.setItem(key, data);
        };
        this.removeItem = function(key) {
          window.localStorage.removeItem(key);
        };

        // Tiles management
        // TODO: localforage can use promise but it doesn't seem to work for
        // now
        this.getTile = function(key, callback) {
          window.localforage.getItem(key, callback);
        };
        this.setTile = function(key, content, callback) {
          window.localforage.setItem(key, content, callback);
        };
        this.removeTile = function(key, callback) {
          window.localforage.removeItem(key, callback);
        };
        this.clearTiles = function(key, callback) {
          window.localforage.clear(callback);
        };
      };
      return new Storage();
    };
  });
})();

