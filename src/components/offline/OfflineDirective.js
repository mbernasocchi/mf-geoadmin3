(function() {
  goog.provide('ga_offline_directive');

  goog.require('ga_map_service');
  goog.require('ga_networkstatus_service');

  var module = angular.module('ga_offline_directive', [
    'ga_map_service',
    'ga_networkstatus_service',
    'pascalprecht.translate'
  ]);

  module.controller('GaOfflineDirectiveController',
    function($scope, $translate, gaOffline, gaNetworkStatus) {
      // Initialize scope variables
      $scope.percent = 0;
      $scope.offline = gaNetworkStatus.offline;

      // gaOffline values watchers
      $scope.$watch(gaOffline.hasData, function(val) {
        $scope.hasOfflineData = val;
      });

      $scope.$watch(gaOffline.isDownloading, function(val) {
        $scope.isDownloading = val;
      });

      $scope.$watch(gaOffline.isSelectorActive, function(val) {
        $scope.isOfflineSelectorActive = val;
      });

      $scope.$watch(gaOffline.isMenuActive, function(val) {
        $scope.isOfflineMenuActive = val;
      });

      // Offline data management
      $scope.save = function() {
        gaOffline.save($scope, $scope.map);
      };

      $scope.abort = function() {
        if (confirm($translate('offline_abort_warning'))) {
          gaOffline.abort();
          gaOffline.hideExtent($scope.map);
        }
      };

      $scope.toggleDataExtent = function() {
        gaOffline.toggleExtent($scope.map);
      };


      // Listeners
      $scope.$on('gaOfflineProgress', function(evt, obj) {
        $scope.$apply(function() {
          $scope.percent = (obj.total > 0) ?
              parseInt((obj.cached + obj.failed) * 100 / obj.total, 10) : 0;
          if (obj.isStorageFull || $scope.percent == 100) {
            $scope.percent = 0;
            $scope.toggleDataExtent();
            gaOffline.hideSelector();
          }
        });
      });
      $scope.$on('gaNetworkStatusChange', function(evt, val) {
        $scope.offline = val;
        if ($scope.offline) {
          if ($scope.isDownloading) {
            gaOffline.abort($scope);
          }
          gaOffline.hideSelector();
        }
      });
    }
  );

  module.directive('gaOfflineBt', function(gaOffline) {
    return {
      restrict: 'A',
      templateUrl: 'components/offline/partials/offline-bt.html',
      controller: 'GaOfflineDirectiveController',
      link: function(scope, elt, attrs) {
        scope.onClick = function(evt) {
          if (!scope.hasOfflineData) {
            gaOffline.toggleSelector();
          } else {
            gaOffline.toggleMenu();
          }
        };
      }
    };
  });

  module.directive('gaOfflineMenu', function(gaOffline) {
    return {
      restrict: 'A',
      templateUrl: 'components/offline/partials/offline-menu.html',
      scope: {
        map: '=gaOfflineMenuMap'
      },
      controller: 'GaOfflineDirectiveController',
      link: function(scope, elt, attrs, controller) {
        scope.openSelector = function() {
          gaOffline.hideMenu();
          gaOffline.showSelector();
        };
        scope.zoom = function() {
          gaOffline.hideMenu();
          gaOffline.showExtent(scope.map);
          gaOffline.displayData(scope.map);
        };
      }
    };
  });

  module.directive('gaOfflineSelector', function(gaStorage) {
    return {
      restrict: 'A',
      templateUrl: function(element, attrs) {
        return 'components/offline/partials/offline-selector.html';
      },
      scope: {
        map: '=gaOfflineSelectorMap',
        options: '=gaOfflineSelectorOptions'
      },
      controller: 'GaOfflineDirectiveController',
      link: function(scope, elt, attrs, controller) {
        var deregister, rectangle, moving, height, width;

        var activate = function() {
          deregister = [
            scope.map.on('postcompose', handlePostCompose),
            scope.map.getView().on('change:rotation', function(evt) {
              moving = true;
            }),
            scope.map.getView().on('change:resolution', function(evt) {
              moving = true;
            }),
            scope.map.on('moveend', function(evt) {
              if (moving) {
                moving = false;
                refreshDisplay();
              }
            }),
            scope.map.on('change:size', function(evt) {
                           refreshDisplay();
            })
          ];
          refreshDisplay();
          elt.show();
          scope.percent = 0;
          scope.isStorageFull = false;
          scope.statusMsg = '';
          scope.map.getView().setZoom(4);
        };

        var deactivate = function() {
          if (deregister) {
            for (var i = 0; i < deregister.length; i++) {
              deregister[i].src.unByKey(deregister[i]);
            }
          }
          rectangle = [0, 0, 0, 0];
          scope.map.render();
          elt.hide();
          if (scope.isDownloading) {
            scope.abort();
          }
        };

        var refreshDisplay = function() {
          updateSize();
          updateRectangle();
          scope.map.render();
        };

        var handlePostCompose = function(evt) {
          evt.context.save();
          if (moving) { // Redraw rectangle only when roatting and zooming
            updateRectangle();
          }
          var ctx = evt.context;
          var topLeft = rectangle[0];
          var topRight = rectangle[1];
          var bottomRight = rectangle[2];
          var bottomLeft = rectangle[3];
          ctx.beginPath();
          // Outside polygon, must be clockwise
          ctx.moveTo(0, 0);
          ctx.lineTo(width, 0);
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.lineTo(0, 0);
          ctx.closePath();
          // Inner polygon,must be counter-clockwise
          ctx.moveTo(topLeft[0], topLeft[1]);
          ctx.lineTo(topRight[0], topRight[1]);
          ctx.lineTo(bottomRight[0], bottomRight[1]);
          ctx.lineTo(bottomLeft[0], bottomLeft[1]);
          ctx.lineTo(topLeft[0], topLeft[1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(0, 5, 25, 0.75)';
          ctx.fill();
          evt.context.restore();
        };

        var updateSize = function() {
          var size = scope.map.getSize();
          width = size[0] * ol.BrowserFeature.DEVICE_PIXEL_RATIO;
          height = size[1] * ol.BrowserFeature.DEVICE_PIXEL_RATIO;
        };

        // We need to calculate every corner to make it rotate
        var updateRectangle = function(scale) {
          var center = scope.map.getView().getCenter();
          var extent = ol.extent.buffer(center.concat(center), 7500);
          var topLeft = scope.map.getPixelFromCoordinate([extent[0],
              extent[3]]);
          var topRight = scope.map.getPixelFromCoordinate([extent[0],
              extent[1]]);
          var bottomRight = scope.map.getPixelFromCoordinate([extent[2],
              extent[1]]);
          var bottomLeft = scope.map.getPixelFromCoordinate([extent[2],
              extent[3]]);
          rectangle = [topLeft, topRight, bottomRight, bottomLeft];
          for (var i = 0; i < 4; i++) {
             rectangle[i][0] *= ol.BrowserFeature.DEVICE_PIXEL_RATIO;
             rectangle[i][1] *= ol.BrowserFeature.DEVICE_PIXEL_RATIO;
          }
        };

        scope.$watch('isOfflineSelectorActive', function(newVal, oldVal) {
          if (newVal === true) {
            activate();
          } else {
            deactivate();
          }
        });

        // Loader management
        var getCssTransform = function(left) {
          var rotation = scope.percent * 360 / 100;
          if (!left && scope.percent > 50) {
            rotation = 180;
          }
          var css = {
            '-webkit-transform': 'rotate(' + rotation + 'deg)',
            'transform': 'rotate(' + rotation + 'deg)'
          };
          return css;
        };
        scope.$on('gaOfflineProgress', function() {
          scope.$apply(function() {
            scope.rotateCssLeft = getCssTransform(true);
            scope.rotateCssRight = getCssTransform(false);
          });
        });

      }
    };
  });


})();

