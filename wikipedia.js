dojo.provide("social.wikipedia");

dojo.require("esri.map");
dojo.require("esri.geometry");
dojo.require("esri.layers.FeatureLayer");
dojo.require("esri.dijit.Popup");

dojo.addOnLoad(function() {
  
	dojo.declare("social.wikipedia", null, {
    
		// Doc: http://docs.dojocampus.org/dojo/declare#chaining
		"-chains-": {
			constructor: "manual"
		},

		constructor: function( options ) {
			this._map = options.map || null;			
			if (this._map === null) {
				throw "social.wikipedia says: Reference to esri.Map object required";
			}
			
			this.autopage = options.autopage || true;
			this.maxpage = options.maxpage || 5;

			//create feature layer for Wikipedia articles
           this.featureCollection = {
                layerDefinition: {
                    "geometryType": "esriGeometryPoint",
                    "drawingInfo": {
                        "renderer": {
                            "type": "simple",
                            "symbol": {
                                "type": "esriPMS",
                                "url": "images/wikipedia-point-16x20.png",
                                "contentType": "image/png",
                                "width": 16,
                                "height": 20
                            }
                        }
                    },
                    "fields": [{
                        "name": "OBJECTID",
                        "type": "esriFieldTypeOID"
                    }, {
                        "name": "id",
                        "type": "esriFieldTypeString",
                        "alias": "id",
                        "length": 100
                    }, {
                        "name": "lat",
                        "type": "esriFieldTypeString",
                        "alias": "Latitude",
                        "length": 1073741822
                    }, {
                        "name": "lng",
                        "type": "esriFieldTypeString",
                        "alias": "Longitude",
                        "length": 1073741822
                    }, {
                        "name": "type",
                        "type": "esriFieldTypeString",
                        "alias": "Type",
                        "length": 100
                    }, {
                        "name": "title",
                        "type": "esriFieldTypeString",
                        "alias": "Title",
                        "length": 1073741822
                    }, {
                        "name": "url",
                        "type": "esriFieldTypeString",
                        "alias": "URL",
                        "length": 255
                    }],
                    "globalIdField": "id",
                    "displayField": "from_user"
                },
                featureSet: {
                    "features": [],
                    "geometryType": "esriGeometryPoint"
                }
            };

			var popupTemplate = new esri.dijit.PopupTemplate({
                title: "Wiki:{title}",
                description: "Location:{lat},{lng}"
            });

            this.infoTemplate = new esri.InfoTemplate();
            this.infoTemplate.setTitle(function(graphic){
                return graphic.attributes.title;
            });

            this.infoTemplate.setContent(this.getWindowContent);
            
            this.featureLayer = new esri.layers.FeatureLayer(this.featureCollection, {
                id: 'wikipediaFeatureLayer',
                outFields: ["*"],
                infoTemplate: this.infoTemplate
            });

            this._map.addLayer(this.featureLayer);

            dojo.connect(this.featureLayer, "onClick", dojo.hitch(this, function(evt){
                var query = new esri.tasks.Query();
                query.geometry = this.pointToExtent(this._map, evt.mapPoint, 20);
                var deferred = this.featureLayer.selectFeatures(query, esri.layers.FeatureLayer.SELECTION_NEW);
                this._map.infoWindow.setFeatures([deferred]);
                this._map.infoWindow.show(evt.mapPoint);
            }));
            
            this.stats = {
                geoPoints: 0,
                geoNames: 0,
                noGeo: 0
            };

            this.dataPoints = [];
            this.deferreds = [];
            this.geocoded_ids = {};
            
            this.loaded = true;
		},
    
		/*****************
		* Public Methods
		*****************/
	
		update: function( searchTerm ){
			this.clear();
			this.constructQuery(searchTerm);
		},

        pointToExtent: function(map, point, toleranceInPixel){
            var pixelWidth = map.extent.getWidth() / map.width;
            var toleraceInMapCoords = toleranceInPixel * pixelWidth;
            return new esri.geometry.Extent(point.x - toleraceInMapCoords, point.y - toleraceInMapCoords, point.x + toleraceInMapCoords, point.y + toleraceInMapCoords, map.spatialReference);
        },

		clear: function() {
			//cancel any outstanding requests
			this.query = null;
			dojo.forEach(this.deferreds, function(def) { 
				def.cancel();
			});
			if(this.deferreds){
				this.deferreds.length = 0;
			}

			//remove existing Articles  
			if (this._map.infoWindow.isShowing) {
				this._map.infoWindow.hide();
			}
			if (this.featureLayer.graphics.length > 0) {
				this.featureLayer.applyEdits(null, null, this.featureLayer.graphics);
			}

			// clear points and stats
			this.stats = {geoPoints:0,noGeo:0,geoNames:0};
			this.dataPoints = [];
			this.geocoded_ids = {};
			this.onClear();
		},

		show: function(){
			this.featureLayer.setVisibility(true);
		},

		hide: function(){
			this.featureLayer.setVisibility(false);
		},

		setVisibility: function(val){
			if(val){
				this.show();
			}
			else{
				this.hide();
			}
		},

		getStats: function(){
			// return object with geoPoints (geocoded this point), noGeo (no geo information in object), and geoNames (non-interpretable)
			var x = this.stats;
			x.total = this.stats.geoPoints + this.stats.noGeo + this.stats.geoNames;
			return x;
		},

		getPoints: function(){
			// return array of {x:LONGITUDE, y:LATITUDE} objects in WebMercator
			return this.dataPoints;
		},
		
		getExtent: function(){
			return esri.graphicsExtent(this.featureLayer.graphics);
		},
		
		getRadius: function(){
			var map = this._map;
			var extent = this.extent || map.extent;
			var rad = Math.ceil(esri.geometry.getLength( new esri.geometry.Point(extent.xmin,extent.ymin, map.spatialReference), new esri.geometry.Point(extent.xmax,extent.ymin, map.spatialReference) ) / 2);
			rad = Math.min(32000, rad);
			return {radius:rad,center:extent.getCenter(),units:"m"};
		},

		setSearchExtent: function(extent){
			this.extent = extent;
		},
    
		/*******************
		* Internal Methods
		*******************/

		getWindowContent: function(graphic) {
			//define content for the Wikipedia pop-up window.
			var article = "http://en.m.wikipedia.org/wiki/" + graphic.attributes.title;
			var content = "<iframe src='" + article + "' width='360' height='160'></iframe>";
			return content;
		},

		constructQuery: function(searchValue) {
			//limit is the number of results returned per page - max 50
			var limit = 50;

			//specify search radius - has to be smaller than 32000 meters (20 miles)
			//when zoom allows, use the width of the map as the radius
			var map = this._map;
			var extent = this.extent || map.extent;
			var rad = this.getRadius().radius;

			var baseurl = "http://api.wikilocation.org/articles";
			var search = dojo.trim(searchValue);
			this.searchTerm = search;

			if (search.length === 0) {
				search = "";
			}

			var center = extent.getCenter();
			center = esri.geometry.webMercatorToGeographic(center);

			this.query = {
				lat: center.y,
				lng: center.x,
				radius: rad,
				limit: limit,
				offset: 0
			};

			//make the actual WikiLocation.org API call
			this.pageCount = 1;
			this.sendRequest(baseurl + "?" + dojo.objectToQuery(this.query));
		},

		sendRequest: function(url) {
			//get the results from Wikipedia for each page
			var deferred = esri.request({
				url: url,
				handleAs: "json",
				callbackParamName: "jsonp",
				load: dojo.hitch(this, function(data) {
					var res = this.unbindDef(deferred);
					if (data.articles.length > 0) {
						this.mapResults(data);
						// if maximum number of results were returned, search for more articles
						if ((this.autopage) && (this.maxpage > this.pageCount) && (data.articles.length >= 50) && (this.query)) {
							this.pageCount++
							this.query.offset += 50;
							this.sendRequest("http://api.wikilocation.org/articles?" + dojo.objectToQuery(this.query));
						}
						else{
							this.onUpdateEnd();
						}
					}
					else{
						// No results found
						this.onUpdateEnd();
					}
				}),
				error: dojo.hitch( this, function(e) {
					if (deferred.canceled) {
						console.log("Search Cancelled");
					}
					else{
						console.log("Search error : " + e.message);
						var res = this.unbindDef(deferred);
					}
					this.onError(e);
					return false;
				})
			});
			this.deferreds.push(deferred);
		},

		unbindDef: function(dfd) {
			//if deferred has already finished, remove from deferreds array
			var index = dojo.indexOf(this.deferreds, dfd);
			if (index === -1) {
				return; // did not find
			}
			this.deferreds.splice(index, 1);
			if (!this.deferreds.length) {
				return 2; // indicates we received results from all expected deferreds
			}
			return 1; // found and removed   
		},

		mapResults: function(j){
			if(j.error){
				console.log("mapResults error: " + j.error);
				this.onError(j.error);
				return
			}
			var b=[];
			var k=j.articles;
			dojo.forEach(k, dojo.hitch(this, function(result){
				// eliminate geo articles which we already have on the map
				if(this.geocoded_ids[result.id]){
					return
				}
				this.geocoded_ids[result.id] = true;

				// eliminate articles unrelated to the search term
				var searchFilter = this.searchTerm.toLowerCase();
				if((result.type.toLowerCase().indexOf(searchFilter) == -1) && ( result.title.toLowerCase().indexOf(searchFilter) == -1 )){
					return;
				}
				var geoPoint = null;
				if(result.lat){
					var g = [result.lat,result.lng];
					geoPoint=new esri.geometry.Point(parseFloat(g[1]),parseFloat(g[0]))
				}
				if(geoPoint){
					if (isNaN(geoPoint.x) || isNaN(geoPoint.y)) {
						this.stats.noGeo++;
					}
					else{
						// convert the Point to WebMercator projection
						var a=new esri.geometry.geographicToWebMercator(geoPoint);
						// make the Point into a Graphic
						var attr = {};
						attr.lat = result.lat;
						attr.lng = result.lng;
						attr.id = result.id;
						attr.type = result.type;
						attr.title = result.title;
						attr.url = result.url;
						var graphic = new esri.Graphic(a);
						graphic.setAttributes(attr);
						b.push(graphic);
						this.dataPoints.push({
							x: a.x,
							y: a.y
						});
						this.stats.geoPoints++;
					}
				}
				else{
					this.stats.noGeo++;
				}
			}));

			this.featureLayer.applyEdits(b, null, null);


			this.onUpdate();
		},

		/*******************
		* Eventing
		*******************/

		onClear: function(){
		},

		onError: function(info){
		},

		onUpdate: function(){
		},
	
		onUpdateEnd: function(){
			this.query = null;
		}

	}); // end of class declaration
}); // end of addOnLoad