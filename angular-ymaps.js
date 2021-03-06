/*global angular*/
angular.module('ymaps', [])
    .factory('$script', ['$q', '$rootScope', function ($q, $rootScope) {
        "use strict";
        //классический кроссбраузерный способ подключить внешний скрипт
        function loadScript(path, callback) {
            var el = document.createElement("script");
            el.onload = el.onreadystatechange = function () {
                if (el.readyState && el.readyState !== "complete" &&
                    el.readyState !== "loaded") {
                    return;
                }
                // если все загрузилось, то снимаем обработчик и выбрасываем callback
                el.onload = el.onreadystatechange = null;
                if (angular.isFunction(callback)) {
                    callback();
                }
            };
            el.async = true;
            el.src = path;
            document.getElementsByTagName('body')[0].appendChild(el);
        }

        var loadHistory = [], //кэш загруженных файлов
            pendingPromises = {}; //обещания на текущие загруки
        return function (url) {
            var deferred = $q.defer();
            if (loadHistory.indexOf(url) !== -1) {
                deferred.resolve();
            }
            else if (pendingPromises[url]) {
                return pendingPromises[url];
            } else {
                loadScript(url, function () {
                    delete pendingPromises[url];
                    loadHistory.push(url);
                    //обязательно использовать `$apply`, чтобы сообщить
                    //angular о том, что что-то произошло
                    $rootScope.$apply(function () {
                        deferred.resolve();
                    });
                });
                pendingPromises[url] = deferred.promise;
            }
            return deferred.promise;
        };
    }])
    .factory('ymapsLoader', ['$window', '$timeout', '$script', 'ymapsConfig', function ($window, $timeout, $script, ymapsConfig) {
        "use strict";
        var scriptPromise;
        return {
            ready: function (callback) {
                if (!scriptPromise) {
                    scriptPromise = $script(ymapsConfig.apiUrl).then(function () {
                        return $window.ymaps;
                    });
                }
                scriptPromise.then(function (ymaps) {
                    ymaps.ready(function () {
                        $timeout(function () {
                            callback(ymaps);
                        });
                    });
                });
            }
        };
    }])
    .constant('ymapsConfig', {
        apiUrl: '//api-maps.yandex.ru/2.1/?load=package.standard,package.clusters&mode=release&lang=ru-RU&ns=ymaps',
        mapBehaviors: ['default'],
        markerOptions: {
            preset: 'islands#darkgreenIcon'
        },
        clusterOptions: {
            preset: 'islands#darkGreenClusterIcons'
        },
        fitMarkers: true,
        fitMarkersZoomMargin: 40,
        //autoFitToViewport: false,
        clusterize: false,
        eventPrefixInDirective: 'ymap'
    })
    .constant('EVENTS', {
        source: {
            yandex: {
                new: 'new-event'
            }
        }
    })
    //brought from underscore http://underscorejs.org/#debounce
    .value('debounce', function (func, wait) {
        "use strict";
        var timeout = null;
        return function () {
            var context = this, args = arguments;
            var later = function () {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    })
    .controller('YmapController', ['$scope', '$element', '$timeout', 'ymapsLoader', 'ymapsConfig', 'debounce', '$rootScope', 'EVENTS', function ($scope, $element, $timeout, ymapsLoader, config, debounce, $rootScope, EVENTS) {
        "use strict";
        function initAutoFit(map, collection, ymaps) {
            collection.events.add('boundschange', debounce(function () {
                if (collection.getLength() > 0 && $scope.checkZoom) {
                    var maxZoomBefore = 23;//map.options.get('maxZoom');
                    map.options.set('maxZoom', $scope.zoom);
                    var bounds = collection.getBounds();
                    if (null !== bounds) {
                        map.setBounds(bounds, {
                            checkZoomRange: true,
                            zoomMargin: config.fitMarkersZoomMargin
                        }).then(function () {
                            map.options.set('maxZoom', maxZoomBefore);
                            //we need to manually update zoom, because of http://clubs.ya.ru/mapsapi/replies.xml?item_no=59735
                            map.setZoom(map.getZoom());
                        });
                    }
                }
            }, 100));
        }

        var self = this;
        ymapsLoader.ready(function (ymaps) {

            self.addMarker = function (coordinates, properties, options) {
                if (angular.isDefined(options.balloonLayout) && (options.balloonLayout == 'hiddenBalloonLayout')) {
                    options.balloonLayout = ymaps.templateLayoutFactory.createClass('<div style="display: none"></div>');
                }

                var placeMark = new ymaps.Placemark(coordinates, properties, options);

                if (config.clusterize) {
                    if (!angular.isDefined(properties.clusterize) || (properties.clusterize && true == properties.clusterize)) {
                        $scope.clusterMarkers.add(placeMark);
                    } else {
                        $scope.markers.add(placeMark);
                    }
                } else {
                    $scope.markers.add(placeMark);
                }

                return placeMark;
            };

            self.removeMarker = function (marker) {
                if (config.clusterize) {
                    if (!angular.isDefined(marker.properties.get('clusterize')) || (marker.properties.get('clusterize') && true == marker.properties.get('clusterize'))) {
                        $scope.clusterMarkers.remove(marker);
                    } else {
                        $scope.markers.remove(marker);
                    }
                } else {
                    $scope.markers.remove(marker);
                }
            };

            self.addPolygon = function (coordinates, properties, options, type) {
                var polygon;
                switch (type) {
                    case "Polyline":
                        polygon = new ymaps.Polyline(coordinates, properties, options);
                        break;
                    default:
                        polygon = new ymaps.Polygon(coordinates, properties, options);
                        break;
                }


                $scope.markers.add(polygon);
                return polygon;
            };

            self.map = new ymaps.Map($element[0], {
                center: $scope.center || [0, 0],
                zoom: $scope.zoom || 0,
                behaviors: config.mapBehaviors
            });

            if (angular.isObject($scope.mapOptions)) {
                angular.forEach($scope.mapOptions, function (v, k) {
                    self.map.options.set(k, v);
                });
            }

            if (angular.isArray($scope.disableControls)) {
                for (var i = 0; i < $scope.disableControls.length; i++) {
                    self.map.controls.remove($scope.disableControls[i]);
                }
            }

            if (angular.isArray($scope.enableControls)) {
                for (var i = 0; i < $scope.enableControls.length; i++) {
                    self.map.controls.add($scope.enableControls[i][0], $scope.enableControls[i][1] || {});
                }
            }

            var collection = new ymaps.GeoObjectCollection({}, config.markerOptions);
            if (config.clusterize) {
                $scope.clusterMarkers = new ymaps.Clusterer(config.clusterOptions);
                collection.add($scope.clusterMarkers);
                $scope.markers = collection;
            } else {
                $scope.markers = collection;
            }

            self.map.geoObjects.add(collection);

            if (config.fitMarkers) {
                initAutoFit(self.map, collection, ymaps);
            }

            var updatingBounds, moving;
            $scope.$watch('center', function (newVal) {
                if (updatingBounds) {
                    return;
                }
                moving = true;
                self.map.panTo(newVal).always(function () {
                    moving = false;
                });
            }, true);
            $scope.$watch('zoom', function (zoom) {
                if (updatingBounds) {
                    return;
                }
                self.map.setZoom(zoom, {checkZoomRange: $scope.checkZoom});
            });

            $scope.$on('$destroy', function () {
                if (self.map) {
                    self.map.destroy();
                }
            });

            self.map.events.add('boundschange', function (event) {
                if (moving) {
                    return;
                }
                //noinspection JSUnusedAssignment
                updatingBounds = true;
                $timeout(function () {
                    $scope.center = event.get('newCenter');
                    $scope.zoom = event.get('newZoom');
                }, 0);
                updatingBounds = false;
            });

            self.registerEventEmitters = function (events) {
                self.map.events.add(events, function (e) {
                    $scope.$broadcast(EVENTS.source.yandex.new, {
                        eventName: e.get('type'),
                        event: e
                    });
                });
            };

        });
    }])
    .directive('yandexMap', ['ymapsLoader', '$parse', 'ymapsConfig', 'EVENTS', function (ymapsLoader, $parse, ymapsConfig, EVENTS) {
        "use strict";
        return {
            restrict: 'EA',
            terminal: true,
            transclude: true,
            scope: {
                center: '=',
                zoom: '=',
                checkZoom: '=',
                mapOptions: '=',
                disableControls: '=',
                enableControls: '='
            },
            link: function ($scope, element, attrs, ctrl, transcludeFn) {

                ymapsLoader.ready(function () {
                    transcludeFn(function (copy) {
                        element.append(copy);
                    });

                    var events = getEventsToFollow();

                    if (events.length > 0) {
                        ctrl.registerEventEmitters(events);
                    }

                });

                function getEventsToFollow() {
                    // @return {array} List of event names normalized to Yandex format

                    var allAttributes = Object.getOwnPropertyNames(attrs);
                    var eventAttributes = [];
                    var events = [];

                    eventAttributes = allAttributes.filter(eventAtrributesFilter);

                    events = eventAttributes.map(normalizeName);

                    function eventAtrributesFilter(attrName) {
                        var re = new RegExp('^' + ymapsConfig.eventPrefixInDirective + '[A-Z]'); // i.e: will match ymapB in 'ymapBaloonopen'
                        return re.test(attrName);
                    }

                    function normalizeName(eventName) {
                        // turn 'ymapBaloonopen' to 'baloonopen' (yandex original format for event name)
                        return eventName.toLowerCase().substr(ymapsConfig.eventPrefixInDirective.length);
                    }

                    return events;
                }

                function findCallback(yandexOrigEventName) {
                    // callback specified as an attribute value, we need to find attribute name and return its value
                    var attributeNameParts = [
                        ymapsConfig.eventPrefixInDirective,
                        yandexOrigEventName.replace(/^[a-zA-Z]/, function upperCaseFirstChar(letter) {
                            return letter.toUpperCase();
                        })
                    ];

                    var attributeName = attributeNameParts.join('');
                    return attrs[attributeName];
                }

                $scope.$on(EVENTS.source.yandex.new, function (e, data) {
                    var callback = $parse(findCallback(data.eventName));
                    callback($scope.$parent, {$event: data.event});
                });
            },
            controller: 'YmapController'
        };
    }])
    .directive('ymapMarker', function () {
        "use strict";
        return {
            restrict: "EA",
            require: '^yandexMap',
            scope: {
                coordinates: '=',
                index: '=',
                properties: '=',
                options: '='
            },
            link: function ($scope, elm, attr, mapCtrl) {
                var marker;

                function pickMarker() {
                    var coord = [
                        parseFloat($scope.coordinates[0]),
                        parseFloat($scope.coordinates[1])
                    ];

                    if (marker) {
                        mapCtrl.removeMarker(marker);
                    }

                    marker = mapCtrl.addMarker(coord, angular.extend({iconContent: $scope.index}, $scope.properties), $scope.options, $scope.clusterize);
                }

                $scope.$watch("index", function (newVal) {
                    if (marker) {
                        marker.properties.set('iconContent', newVal);
                    }
                });
                $scope.$watch("coordinates", function (newVal) {
                    if (newVal) {
                        pickMarker();
                    }
                }, true);
                $scope.$on('$destroy', function () {
                    if (marker) {
                        mapCtrl.removeMarker(marker);
                    }
                });
            }
        };
    })
    .directive('ymapPolygon', function () {
        "use strict";
        return {
            restrict: "EA",
            require: '^yandexMap',
            scope: {
                coordinates: '=',
                properties: '=',
                options: '=',
                type: '@'
            },
            link: function ($scope, elm, attr, mapCtrl) {
                var polygon;

                function pickPolygon() {
                    if (polygon) {
                        mapCtrl.removeMarker(polygon);
                    }
                    polygon = mapCtrl.addPolygon($scope.coordinates, $scope.properties || {}, $scope.options || {}, $scope.type);
                }

                //if (angular.isArray($scope.coordinates)) {
                //    polygon = mapCtrl.addPolygon($scope.coordinates, $scope.properties, $scope.options, $scope.type);
                //}

                $scope.$watch("coordinates", function (newVal) {
                    if (newVal) {
                        pickPolygon();
                    }
                }, true);

                $scope.$on('$destroy', function () {
                    if (polygon) {
                        mapCtrl.removeMarker(polygon);
                    }
                });
            }
        };
    })
    .directive('ymapRoute', [function () {
        "use strict";
        return {
            restrict: "EA",
            require: '^yandexMap',
            scope: {
                points: '='
            },
            link: function ($scope, elm, attr, mapCtrl) {
                $scope.route = null;

                $scope.$watch('points',
                    function (newVal) {
                        if (newVal && angular.isDefined(newVal.from) && angular.isDefined(newVal.from.point) && angular.isDefined(newVal.to) && angular.isDefined(newVal.to.point)) {
                            ymaps.route([newVal.from.point, newVal.to.point]).then(function (route) {
                                $scope.route = route;
                                mapCtrl.map.geoObjects.add(route);
                                var points = route.getWayPoints(), lastPoint = points.getLength() - 1;
                                points.options.set('preset', 'twirl#blueStretchyIcon');
                            }, function (error) {
                                alert('Ошибка построения маршрута');
                            });
                        } else {
                            if (null !== $scope.route) {
                                mapCtrl.map.geoObjects.remove($scope.route);
                                $scope.route = null;
                            }
                        }
                    },
                    true
                );
            }
        }
    }]);
