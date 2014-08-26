(function() {
  goog.provide('ga_draw_directive');

  goog.require('ga_map_service');

  var module = angular.module('ga_draw_directive', [
    'ga_map_service',
    'pascalprecht.translate'
  ]);

  module.directive('gaDraw',
    function($timeout, $translate, $window, gaDefinePropertiesForLayer,
        gaLayerFilters) {


        /*\
        |*|
        |*|  Base64 / binary data / UTF-8 strings utilities
        |*|
        |*|  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Base64_encoding_and_decoding
        |*|
        \*/

        /* Array of bytes to base64 string decoding */

        function b64ToUint6 (nChr) {

          return nChr > 64 && nChr < 91 ?
              nChr - 65
            : nChr > 96 && nChr < 123 ?
              nChr - 71
            : nChr > 47 && nChr < 58 ?
              nChr + 4
            : nChr === 43 ?
              62
            : nChr === 47 ?
              63
            :
              0;

        }

        function base64DecToArr (sBase64, nBlocksSize) {

          var
            sB64Enc = sBase64.replace(/[^A-Za-z0-9\+\/]/g, ""), nInLen = sB64Enc.length,
            nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2, taBytes = new Uint8Array(nOutLen);

          for (var nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
            nMod4 = nInIdx & 3;
            nUint24 |= b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 18 - 6 * nMod4;
            if (nMod4 === 3 || nInLen - nInIdx === 1) {
              for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
                taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
              }
              nUint24 = 0;

            }
          }

          return taBytes;
        }

        /* Base64 string to array encoding */

        function uint6ToB64 (nUint6) {

          return nUint6 < 26 ?
              nUint6 + 65
            : nUint6 < 52 ?
              nUint6 + 71
            : nUint6 < 62 ?
              nUint6 - 4
            : nUint6 === 62 ?
              43
            : nUint6 === 63 ?
              47
            :
              65;

        }

        function base64EncArr (aBytes) {

          var nMod3 = 2, sB64Enc = "";

          for (var nLen = aBytes.length, nUint24 = 0, nIdx = 0; nIdx < nLen; nIdx++) {
            nMod3 = nIdx % 3;
            if (nIdx > 0 && (nIdx * 4 / 3) % 76 === 0) { sB64Enc += "\r\n"; }
            nUint24 |= aBytes[nIdx] << (16 >>> nMod3 & 24);
            if (nMod3 === 2 || aBytes.length - nIdx === 1) {
              sB64Enc += String.fromCharCode(uint6ToB64(nUint24 >>> 18 & 63), uint6ToB64(nUint24 >>> 12 & 63), uint6ToB64(nUint24 >>> 6 & 63), uint6ToB64(nUint24 & 63));
              nUint24 = 0;
            }
          }

          return sB64Enc.substr(0, sB64Enc.length - 2 + nMod3) + (nMod3 === 2 ? '' : nMod3 === 1 ? '=' : '==');

        }

        /* UTF-8 array to DOMString and vice versa */

        function UTF8ArrToStr (aBytes) {

          var sView = "";

          for (var nPart, nLen = aBytes.length, nIdx = 0; nIdx < nLen; nIdx++) {
            nPart = aBytes[nIdx];
            sView += String.fromCharCode(
              nPart > 251 && nPart < 254 && nIdx + 5 < nLen ? /* six bytes */
                /* (nPart - 252 << 32) is not possible in ECMAScript! So...: */
                (nPart - 252) * 1073741824 + (aBytes[++nIdx] - 128 << 24) + (aBytes[++nIdx] - 128 << 18) + (aBytes[++nIdx] - 128 << 12) + (aBytes[++nIdx] - 128 << 6) + aBytes[++nIdx] - 128
              : nPart > 247 && nPart < 252 && nIdx + 4 < nLen ? /* five bytes */
                (nPart - 248 << 24) + (aBytes[++nIdx] - 128 << 18) + (aBytes[++nIdx] - 128 << 12) + (aBytes[++nIdx] - 128 << 6) + aBytes[++nIdx] - 128
              : nPart > 239 && nPart < 248 && nIdx + 3 < nLen ? /* four bytes */
                (nPart - 240 << 18) + (aBytes[++nIdx] - 128 << 12) + (aBytes[++nIdx] - 128 << 6) + aBytes[++nIdx] - 128
              : nPart > 223 && nPart < 240 && nIdx + 2 < nLen ? /* three bytes */
                (nPart - 224 << 12) + (aBytes[++nIdx] - 128 << 6) + aBytes[++nIdx] - 128
              : nPart > 191 && nPart < 224 && nIdx + 1 < nLen ? /* two bytes */
                (nPart - 192 << 6) + aBytes[++nIdx] - 128
              : /* nPart < 127 ? */ /* one byte */
                nPart
            );
          }

          return sView;

        }

        function strToUTF8Arr (sDOMStr) {

          var aBytes, nChr, nStrLen = sDOMStr.length, nArrLen = 0;

          /* mapping... */

          for (var nMapIdx = 0; nMapIdx < nStrLen; nMapIdx++) {
            nChr = sDOMStr.charCodeAt(nMapIdx);
            nArrLen += nChr < 0x80 ? 1 : nChr < 0x800 ? 2 : nChr < 0x10000 ? 3 : nChr < 0x200000 ? 4 : nChr < 0x4000000 ? 5 : 6;
          }

          aBytes = new Uint8Array(nArrLen);

          /* transcription... */

          for (var nIdx = 0, nChrIdx = 0; nIdx < nArrLen; nChrIdx++) {
            nChr = sDOMStr.charCodeAt(nChrIdx);
            if (nChr < 128) {
              /* one byte */
              aBytes[nIdx++] = nChr;
            } else if (nChr < 0x800) {
              /* two bytes */
              aBytes[nIdx++] = 192 + (nChr >>> 6);
              aBytes[nIdx++] = 128 + (nChr & 63);
            } else if (nChr < 0x10000) {
              /* three bytes */
              aBytes[nIdx++] = 224 + (nChr >>> 12);
              aBytes[nIdx++] = 128 + (nChr >>> 6 & 63);
              aBytes[nIdx++] = 128 + (nChr & 63);
            } else if (nChr < 0x200000) {
              /* four bytes */
              aBytes[nIdx++] = 240 + (nChr >>> 18);
              aBytes[nIdx++] = 128 + (nChr >>> 12 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 6 & 63);
              aBytes[nIdx++] = 128 + (nChr & 63);
            } else if (nChr < 0x4000000) {
              /* five bytes */
              aBytes[nIdx++] = 248 + (nChr >>> 24);
              aBytes[nIdx++] = 128 + (nChr >>> 18 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 12 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 6 & 63);
              aBytes[nIdx++] = 128 + (nChr & 63);
            } else /* if (nChr <= 0x7fffffff) */ {
              /* six bytes */
              aBytes[nIdx++] = 252 + /* (nChr >>> 32) is not possible in ECMAScript! So...: */ (nChr / 1073741824);
              aBytes[nIdx++] = 128 + (nChr >>> 24 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 18 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 12 & 63);
              aBytes[nIdx++] = 128 + (nChr >>> 6 & 63);
              aBytes[nIdx++] = 128 + (nChr & 63);
            }
          }

          return aBytes;

        }

        var strToBase64 = function(str) {
          return base64EncArr(strToUTF8Arr(str));
        };

      return {
        restrict: 'A',
        templateUrl: function(element, attrs) {
          return 'components/draw/partials/draw.html';
        },
        scope: {
          map: '=gaDrawMap',
          options: '=gaDrawOptions',
          isActive: '=gaDrawActive'
        },
        link: function(scope, elt, attrs, controller) {
          var draw, modify, select, deregister, sketchFeature, lastActiveTool;
          var map = scope.map;
          var source = new ol.source.Vector();
          var layer = new ol.layer.Vector({
            source: source,
            visible: true,
            style: scope.options.styleFunction
          });
          gaDefinePropertiesForLayer(layer);
          layer.displayInLayerManager = false;
          scope.layers = scope.map.getLayers().getArray();
          scope.layerFilter = gaLayerFilters.selected;


          // Activate the component: active a tool if one was active when draw
          // has been deactivated.
          var activate = function() {
            if (lastActiveTool) {
              activateTool(lastActiveTool);
            }
          };

          // Deactivate the component: remove layer and interactions.
          var deactivate = function() {

            // Deactivate the tool
            if (lastActiveTool) {
              scope.options[lastActiveTool.activeKey] = false;
            }

            // Remove interactions
            deactivateDrawInteraction();
            deactivateSelectInteraction();
            deactivateModifyInteraction();
          };


          // Deactivate other tools
          var activateTool = function(tool) {
            layer.visible = true;

            if (map.getLayers().getArray().indexOf(layer) == -1) {
              map.addLayer(layer);
              // Move draw layer  on each changes in the list of layers
              // in the layer manager.
              scope.$watchCollection('layers | filter:layerFilter',
                  moveLayerOnTop);
            }

            moveLayerOnTop();

            var tools = scope.options.tools;
            for (var i = 0, ii = tools.length; i < ii; i++) {
              scope.options[tools[i].activeKey] = (tools[i].id == tool.id);
            }

            if (tool.id == 'delete') {
             return;
            }

            scope.options.instructions = tool.instructions;
            lastActiveTool = tool;
            setFocus();
          };

          // Set the draw interaction with the good geometry
          var activateDrawInteraction = function(type) {
            deactivateDrawInteraction();
            deactivateSelectInteraction();
            deactivateModifyInteraction();

            draw = new ol.interaction.Draw({
              type: type,
              source: source,
              style: scope.options.drawStyleFunction
            });

            deregister = [
              draw.on('drawstart', function(evt) {
                sketchFeature = evt.feature;
              }),
              draw.on('drawend', function(evt) {
                // Set the definitve style of the feature
                var style = layer.getStyleFunction()(sketchFeature);
                sketchFeature.setStyle(style);
              })
            ];

            if (scope.isActive) {
              map.addInteraction(draw);
            }
          };

          var deactivateDrawInteraction = function() {

            // Remove events
            if (deregister) {
              for (var i = deregister.length - 1; i >= 0; i--) {
                deregister[i].src.unByKey(deregister[i]);
              }
              deregister = null;
            }

            draw = deactivateInteraction(draw);
          };

          // Set the select interaction
          var activateSelectInteraction = function() {
            deactivateDrawInteraction();
            deactivateSelectInteraction();
            deactivateModifyInteraction();

            select = new ol.interaction.Select({
              layer: layer,
              style: scope.options.selectStyleFunction
            });

            if (scope.isActive) {
              map.addInteraction(select);
              select.getFeatures().on('add', updateUseStyles);
              select.getFeatures().on('remove', updateUseStyles);
            }
          };

          var deactivateSelectInteraction = function() {
            scope.useTextStyle = false;
            scope.useIconStyle = false;
            scope.useColorStyle = false;
            select = deactivateInteraction(select);
          };

          // Set the select interaction
          var activateModifyInteraction = function() {
            activateSelectInteraction();

            modify = new ol.interaction.Modify({
              features: select.getFeatures(),
              style: scope.options.selectStyleFunction
            });

            if (scope.isActive) {
              map.addInteraction(modify);
            }
          };

          var deactivateModifyInteraction = function() {
            modify = deactivateInteraction(modify);
          };

          // Deactivate an interaction
          var deactivateInteraction = function(interaction) {
            if (interaction) {
              map.removeInteraction(interaction);
            }
            return undefined;
          };

          // Update selected feature with a new style
          var updateSelectedFeatures = function() {
            if (select) {
              var features = select.getFeatures();
              if (features) {
                features.forEach(function(feature) {
                  // Update the style function of the feature
                  feature.setStyle(function() {return null;});
                  var style = layer.getStyleFunction()(feature);
                  feature.setStyle(style);
                });
              }
            }
          };

          // Determines which styles are used by selected fetures
          var updateUseStyles = function(evt) {
            var features = select.getFeatures().getArray();
            var useTextStyle = false;
            var useIconStyle = false;
            var useColorStyle = false;

            for (var i = 0, ii = features.length; i < ii; i++) {
              var styles = features[i].getStyleFunction()();
              if (styles[0].getImage() instanceof ol.style.Icon) {
                useIconStyle = true;
                continue;
              } else if (styles[0].getText()) {
                useTextStyle = true;
              }
              useColorStyle = true;
            }
            scope.$apply(function() {
              scope.useTextStyle = useTextStyle;
              scope.useIconStyle = useIconStyle;
              scope.useColorStyle = useColorStyle;
            });
          };

          // Delete all features of the layer
          var deleteAllFeatures = function() {
            if (confirm($translate('confirm_remove_all_features'))) {
              layer.getSource().clear();
            }

            // We reactivate the lastActiveTool
            if (lastActiveTool) {
              activateTool(lastActiveTool);
            }
          };


          // Activate/deactivate a tool
          scope.toggleTool = function(tool) {
            if (scope.options[tool.activeKey]) {
              // Deactivate all tools
              deactivate();
              lastActiveTool = undefined;

            } else {
              activateTool(tool);
            }
          };

          // Delete selected features by the edit tool
          scope.deleteFeatures = function() {
            if (confirm($translate('confirm_remove_selected_features')) &&
                select) {
              var features = select.getFeatures();
              if (features) {
                features.forEach(function(feature) {
                  layer.getSource().removeFeature(feature);
                });
                // We reactivate the select interaction instead of clearing
                // directly the selectd features array to avoid an digest cycle
                // error in updateUseStyles function
                activateSelectInteraction();
              }
            }
          };

          scope.exportKml = function() {
            var exportFeatures = [];
            source.forEachFeature(function(f) {
                var clone = f.clone();
                clone.setId(f.getId());
                //clone.getGeometry().transform(projection, 'EPSG:4326');
                var styles = clone.getStyleFunction()();
                var newStyle = {
                  fill: styles[0].getFill(),
                  stroke: styles[0].getStroke(),
                  test: styles[0].getText(),
                  image: styles[0].getImage(),
                  zIndex: styles[0].getZIndex()
                };
                if (newStyle.image instanceof ol.style.Circle) {
                  newStyle.image = null;
                }
                var myStyle = new ol.style.Style(newStyle);
                clone.setStyle(myStyle);

                exportFeatures.push(clone);
            });
            if (exportFeatures.length > 0) {
              window.console.log(exportFeatures.length);
              var node = new ol.format.KML().writeFeatures(exportFeatures);
              var string = new XMLSerializer().serializeToString(node);
              var base64 = strToBase64(string);
              $window.location = 'data:application/vnd.google-earth.kml+xml;base64,'
                  + base64;
            }
          };

          scope.aToolIsActive = function() {
            return !!lastActiveTool;
          };

          // Watchers
          scope.$watch('isActive', function(active) {
            if (active) {
              activate();
            } else {
              deactivate();
            }
          });

          scope.$watch('options.iconSize', function(active) {
            if (scope.options.isModifyActive) {
              updateSelectedFeatures();
            }
          });

          scope.$watch('options.icon', function(active) {
            if (scope.options.isModifyActive) {
              updateSelectedFeatures();
            }
          });

          scope.$watch('options.color', function(active) {
            if (scope.options.isModifyActive) {
              updateSelectedFeatures();
            }
          });
          scope.$watch('options.text', function(active) {
            if (scope.options.isModifyActive) {
              updateSelectedFeatures();
            }
          });

          scope.$watch('options.isPointActive', function(active) {
            if (active) {
              activateDrawInteraction('Point');
            }
          });
          scope.$watch('options.isLineActive', function(active) {
            if (active) {
              activateDrawInteraction('LineString');
            }
          });
          scope.$watch('options.isPolygonActive', function(active) {
            if (active) {
              activateDrawInteraction('Polygon');
            }
          });
          scope.$watch('options.isTextActive', function(active) {
            if (active) {
              activateDrawInteraction('Point');
            }
          });
          scope.$watch('options.isModifyActive', function(active) {
            if (active) {
              activateModifyInteraction();
            }
          });
          scope.$watch('options.isDeleteActive', function(active) {
            if (active) {
              deleteAllFeatures();
              scope.options.isDeleteActive = false;
            }
          });


          // Utils

          // Focus on the first input.
          var setFocus = function() {
            $timeout(function() {
              var inputs = $(elt).find('input, select');
              if (inputs.length > 0) {
                inputs[0].focus();
              }
            });
          };

          // Move the draw layer on top
          var moveLayerOnTop = function() {
            var idx = scope.layers.indexOf(layer);
            if (idx != -1 && idx !== scope.layers.length - 1) {
              map.removeLayer(layer);
              map.addLayer(layer);
            }
          };

        }
      };
    }
  );
})();
