(function() {
  goog.provide('ga_offline_service');

  goog.require('ga_storage_service');
  goog.require('ga_styles_service');

  var module = angular.module('ga_offline_service', [
    'ga_storage_service',
    'ga_styles_service'
  ]);

  /**
   * Service provides map offline functions.
   */
  module.provider('gaOffline', function() {
    var extentKey = 'ga-offline-extent';
    var layersKey = 'ga-offline-layers';
    var maxZoom = 8; // max zoom level cached
    var minRes = 2.5; // res for zoom 8
    var extentFeature = new ol.Feature(
        new ol.geom.Polygon([[[0, 0], [0, 0], [0, 0]]]));
    var featureOverlay = new ol.FeatureOverlay({
      features: [extentFeature]
    });

    // Get the magnide of 3D vector from an origin.
    // Used to order tiles by the distance from the map center.
    var getMagnitude = function(a, origin) {
      var aX = a.getX() + 0.5;
      var aY = a.getY() + 0.5;
      var aZ = a.getZ();
      var oa = Math.sqrt(
          Math.pow(aX - origin.x, 2) +
          Math.pow(aY - origin.y, 2) +
          Math.pow(aZ - origin.z, 2));
      return oa;
    };

    // Defined if a layer is cacheable at a specific data zoom level.
    var isCacheableLayer = function(layer, z) {
      if (layer.getSource() instanceof ol.source.TileImage) {
        var resolutions = layer.getSource().getTileGrid().getResolutions();
        var min = layer.getMinResolution() ||
            resolutions[resolutions.length - 1];
        var max = layer.getMaxResolution() || resolutions[0];
        var res = z ? resolutions[z] : minRes;
        if ((!max || max > res) && (!min || res >= min)) {
          return true;
        }
      }
      return false;
    };


    // Get cacheable layers of a map.
    var getCacheableLayers = function(layers) {
      var cache = [];
      for (var i = 0, ii = layers.length; i < ii; i++) {
        var layer = layers[i];
        if (layer instanceof ol.layer.Group) {
          cache = cache.concat(
              getCacheableLayers(layer.getLayers().getArray()));
        } else if (isCacheableLayer(layer)) {
          cache.push(layer);
        }
      }
      return cache;
    };

    var extentOnMap = false;
    var isDownloading;
    var isStorageFull;
    var nbTilesCached;
    var nbTilesEmpty;
    var nbTilesFailed;
    var nbTilesTotal;
    var requests;
    var sizeCached;
    var startTime;
    var errorReport;

    var initDownloadStatus = function() {
      isDownloading = false;
      isStorageFull = false;
      nbTilesCached = 0;
      nbTilesEmpty = 0;
      nbTilesFailed = 0;
      nbTilesTotal = 0;
      requests = [];
      sizeCached = 0;
      errorReport = '';
    };
    initDownloadStatus();

    var broadcastDlProgress = function(scope) {
      var nbTiles = nbTilesCached + nbTilesFailed;
      if (isStorageFull || nbTiles == nbTilesTotal) {
        isDownloading = false;
        // Magic formula: http://en.wikipedia.org/wiki/Base64
        // 814: size of an header of a base64 object
        // 1.37: increase size factor
        /*window.console.log(
            'Blob size cached: ' + sizeCached +
            '\nBase 64 (approx.) size cached: ' + (sizeCached * 1.37 +
                nbTilesCached * 814) +
            '\nEmpty: ' + nbTilesEmpty +
            '\nFailed: ' + nbTilesFailed +
            '\nCached: ' + nbTilesCached +
            '\nTotal: ' + nbTilesTotal +
            '\nDuration: ' + ((new Date()).getTime() - startTime));
        */
      }

      if (!isDownloading || nbTiles % 50 === 0) {
        scope.$broadcast('gaOfflineProgress', {
          cached: nbTilesCached,
          failed: nbTilesFailed,
          sizeCached: sizeCached,
          total: nbTilesTotal,
          isStorageFull: isStorageFull
        });
      }
    };

    var onTileError = function(scope, err) {
      nbTilesFailed++;
      window.console.log('\nTile failed: ' + err.url + '\n Cause:' + err.msg);
      errorReport += '\nTile failed: ' + err.url + '\n Cause:' + err.msg;
      broadcastDlProgress(scope);
    };

    this.$get = function($timeout, $translate, gaBrowserSniffer,
        gaGlobalOptions, gaLayers, gaMapUtils, gaStorage, gaStyleFactory,
        gaUrlUtils) {
      featureOverlay.setStyle(gaStyleFactory.getStyle('offline'));

      var readResponse = function(scope, req, onSuccess) {

        // Storage is full no need to go further
        if (isStorageFull) {
          onTileError(scope, {url: req.tileUrl, msg: 'Storage full'});
          return;
        }

        var buffer = req.response;

        // Tile empty
        if (!buffer || buffer.byteLength === 0) {
          nbTilesEmpty++;
          onTileError(scope, {url: req.tileUrl, msg: 'Tile empty'});
          return;
        }

        var tileUrl = req.tileUrl;
        var contentType = req.getResponseHeader('content-type');
        // Advantage of the blob is we have easy access to the size and the
        // type of the image, moreover in the future we could store it
        // directly in indexedDB, no need of fileReader anymore.
        // We could request a 'blob' instead of 'arraybuffer' response type
        // but android browser needs arraybuffer.
        var blob;
        if (window.WebKitBlobBuilder) {
          // BlobBuilder is deprecated, only used in Android Browser
          var builder = new WebKitBlobBuilder();
          builder.append(buffer);
          blob = builder.getBlob(contentType);
        } else {
          blob = new Blob([buffer], {type: contentType});
        }

        var fileReader = new FileReader();
        fileReader.onload = function(evt) {
          gaStorage.setTile(gaMapUtils.getTileKey(tileUrl), evt.target.result,
              function(content, err) {
                if (err) {
                  if (!isStorageFull) {
                    alert($translate('offline_space_warning'));
                  }
                  isStorageFull = true;
                  onTileError(scope, {url: tileUrl, msg: err.message});
                } else {
                  sizeCached += blob.size;
                  nbTilesCached++;
                  broadcastDlProgress(scope);
                }
              });
         };
        fileReader.onerror = function(evt) {
          onTileError(scope, {url: tileUrl, msg: 'File read failed'});
        };
        fileReader.readAsDataURL(blob);
      };

      var Offline = function() {
        this.hasData = function(map) {
          return !!(gaStorage.getItem(extentKey));
        };

        this.refreshLayers = function(layers, useClientZoom, force) {
          var layersIds = gaStorage.getItem(layersKey);
          for (var i = 0, ii = layers.length; i < ii; i++) {
            var layer = layers[i];
            if (layer instanceof ol.layer.Group) {
             var hasCachedLayer = false;
             layer.getLayers().forEach(function(item) {
               if (!hasCachedLayer && layersIds &&
                   layersIds.indexOf(item.id) != -1) {
                 hasCachedLayer = true;
               }
             });
             this.refreshLayers(layer.getLayers().getArray(), useClientZoom,
                 force || hasCachedLayer);
            } else if (force || (layersIds &&
                layersIds.indexOf(layer.id) != -1)) {
              var source = layer.getSource();
              // Clear the internal tile cache of ol
              // TODO: Ideally we should flush the cache for the tile range
              // cached
              source.setTileLoadFunction(source.getTileLoadFunction());

              // Defined a new min resolution to allow client zoom on layer with
              // a min resolution between the max zoom level and the max client
              // zoom level
              var origMinRes = gaLayers.getLayer(layer.id).minResolution;
              if (!useClientZoom && origMinRes) {
                layer.setMinResolution(origMinRes);
              } else if (useClientZoom && minRes >= origMinRes) {
                layer.setMinResolution(undefined);
              }
              // Allow client zoom on all layer when offline
              layer.setUseInterimTilesOnError(useClientZoom);
            }
          }
        };

        // Download status
        this.isDownloading = function() {
          return isDownloading;
        };

        // Offline selector stuff
        var isSelectorActive = false;
        this.isSelectorActive = function() {
          return isSelectorActive;
        };
        this.showSelector = function() {
          isSelectorActive = true;
        };
        this.hideSelector = function() {
          isSelectorActive = false;
        };
        this.toggleSelector = function() {
          isSelectorActive = !isSelectorActive;
        };

        // Offline menu stuff
        var isMenuActive = false;
        this.isMenuActive = function() {
          return isMenuActive;
        };
        this.showMenu = function() {
          isMenuActive = true;
        };
        this.hideMenu = function() {
          isMenuActive = false;
        };
        this.toggleMenu = function() {
          isMenuActive = !isMenuActive;
        };


        // Extent saved stuff
        this.showExtent = function(map) {
          var extent = gaStorage.getItem(extentKey);
          if (extent) {
            extent = extent.split(',');
            extentFeature.getGeometry().setCoordinates([[
              [extent[0], extent[1]],
              [extent[0], extent[3]],
              [extent[2], extent[3]],
              [extent[2], extent[1]]
              ]]);
            featureOverlay.setMap(map);
            extentOnMap = true;
          }
        };
        this.hideExtent = function() {
          featureOverlay.setMap(null);
          extentOnMap = false;
        };
        this.toggleExtent = function(map) {
          if (extentOnMap) {
            this.hideExtent(map);
          } else {
            this.showExtent(map);
          }
        };
        this.zoomOnExtent = function(map) {
          var extent = gaStorage.getItem(extentKey);
          if (extent) {
            extent = extent.split(',');
            map.getView().fitExtent([
              parseInt(extent[0], 10),
              parseInt(extent[1], 10),
              parseInt(extent[2], 10),
              parseInt(extent[3], 10)
            ], map.getSize());
          }
        };

        // Download stuff
        this.abort = function(scope) {

          // We abort the requests and clear the storage
          for (var j = 0, jj = requests.length; j < jj; j++) {
            requests[j].abort();
          }

          // Clear the db if necessary
          if (this.hasData()) {
            gaStorage.clearTiles();
          }
          gaStorage.removeItem(extentKey);
          gaStorage.removeItem(layersKey);

          this.hideExtent();
          initDownloadStatus();

          if (scope) {
            scope.$broadcast('gaOfflineAbort', {});
          }
        };
        this.save = function(scope, map) {

          var layers = getCacheableLayers(map.getLayers().getArray());
          if (layers.length == 0 ||
              !confirm($translate('offline_save_warning'))) {
            return;
          }
          this.abort();
          // Re-init progress status in others component.
          isDownloading = true;
          var center = map.getView().getCenter();
          var extent = ol.extent.buffer(center.concat(center), 7500);
          gaStorage.setItem(extentKey, extent);
          if (extentOnMap) {
            this.showExtent(map);
          }

          // We get through all the cacheable layers and construct and array
          // with all the tiles properties (coordinate and url) to download.
          var zoom = map.getView().getZoom();
          var projection = map.getView().getView2D().getProjection();
          var queue = [];
          var layersIds = [];
          for (var i = 0, ii = layers.length; i < ii; i++) {
            var layer = layers[i];
            layersIds.push(layer.id);
            var isBgLayer = (gaLayers.getLayerProperty(layer.bodId,
                'background'));
            var source = layer.getSource();
            var tileGrid = source.getTileGrid();
            var tileUrlFunction = source.getTileUrlFunction();
            var centerTileCoord;
            // We generate and sort by distance the list of all tiles
            // we can saved
            // zoom = 0 to zoom = 8 => 1100 tiles  => 50mo
            for (var zoom = 0; zoom <= maxZoom; zoom++) {
              var z = zoom + 14; // data zoom level
              if (!isCacheableLayer(layer, z) || (!isBgLayer && (zoom < 4 ||
                zoom % 2 != 0))) {
                continue;
              }

              // If not a background layer only save the 15km2 extent
              var tileExtent = (isBgLayer && zoom >= 0 && zoom <= 2) ?
                  [420000, 30000, 900000, 350000] : extent;
              var queueByZ = [];
              var tileRange = tileGrid.getTileRangeForExtentAndZ(tileExtent, z);
              for (var x = tileRange.getMinX(); x <= tileRange.getMaxX(); x++) {
                for (var y = tileRange.getMinY(); y <= tileRange.getMaxY();
                    y++) {
                  var tileCoord = new ol.TileCoord(z, x, y);
                  var tile = {
                    coord: tileCoord,
                    url: tileUrlFunction(tileCoord,
                        ol.BrowserFeature.DEVICE_PIXEL_RATIO, projection)
                  };
                  queueByZ.push(tile);
                }
              }
              centerTileCoord = {
                x: (tileRange.getMinX() + tileRange.getMaxX()) / 2,
                y: (tileRange.getMinY() + tileRange.getMaxY()) / 2,
                z: z
              };
              queueByZ.sort(function(a, b) {
                return getMagnitude(a.coord, centerTileCoord) -
                    getMagnitude(b.coord, centerTileCoord);
              });
              queue = queue.concat(queueByZ);
            }
          }
          gaStorage.setItem(layersKey, layersIds.join(','));

          nbTilesTotal = queue.length;
          startTime = (new Date()).getTime();
          // We create/launch the request by 5, to avoid breaking the browser
          var cursor = 0;
          var pool = 5;
          var requestsLoaded;
          var runNextRequests = function() {
            requestsLoaded = 0;
            for (var j = cursor, jj = cursor + pool; j < jj &&
                j < queue.length; j++) {
              var tile = queue[j];
              // TODO: remove use of ogcproxy ? only failed on IE currently.
              var xhr = new XMLHttpRequest();
              xhr.tileUrl = tile.url;
              xhr.open('GET', gaGlobalOptions.ogcproxyUrl +
                  gaUrlUtils.encodeUriQuery(
                    gaUrlUtils.transformIfAgnostic(tile.url)), true);
              xhr.responseType = 'arraybuffer';
              xhr.onload = function(e) {
                readResponse(scope, e.target);
              };
              xhr.onerror = function(e) {
                onTileError(scope, {
                  url: e.target.tileUrl,
                  msg: e.target.statusText
                });
              };
              xhr.onloadend = function() {
                if (!isStorageFull && ++requestsLoaded == pool) {
                  if (gaBrowserSniffer.mobile && j % 200 === 0) {
                    // We make a pause to don't break the mobile browser
                    $timeout(runNextRequests, 5000);
                  } else {
                    runNextRequests();
                  }
                }
              };
              xhr.send();
              requests.push(xhr);
              cursor++;
            }
          };
          runNextRequests();
        };

        // If there is data in db we can initialize the store
        if (this.hasData()) {
          gaStorage.init();
        }
      };
      return new Offline();
    };
  });

})();

