dojo.provide("social.flickr");

dojo.require("esri.map");
dojo.require("esri.geometry");
dojo.require("esri.layers.FeatureLayer");
dojo.require("esri.dijit.Popup");

dojo.addOnLoad(function() {

	dojo.declare("social.flickr", null, {
    
		// Doc: http://docs.dojocampus.org/dojo/declare#chaining
		"-chains-": {
			constructor: "manual"
		},
    
		constructor: function( options ) {
			this._map = options.map || null;			
			if (this._map === null) {
				throw "social.flickr says: Reference to esri.Map object required";
			}
			
			this.autopage = options.autopage || true;
			this.maxpage = options.maxpage || 5;

			//create feature layer for Flickr Photos
           this.featureCollection = {
                layerDefinition: {
                    "geometryType": "esriGeometryPoint",
                    "drawingInfo": {
                        "renderer": {
                            "type": "simple",
                            "symbol": {
                                "type": "esriPMS",
                                "url": "images/flickr-point-16x20.png",
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
                        "name": "owner",
                        "type": "esriFieldTypeString",
                        "alias": "User",
                        "length": 100
                    }, {
                        "name": "latitude",
                        "type": "esriFieldTypeDouble",
                        "alias": "latitude",
                        "length": 1073741822
                    }, {
                        "name": "longitude",
                        "type": "esriFieldTypeDouble",
                        "alias": "longitude",
                        "length": 1073741822
                    }, {
                        "name": "title",
                        "type": "esriFieldTypeString",
                        "alias": "Title",
                        "length": 1073741822
                    }],
                    "globalIdField": "id",
                    "displayField": "title"
                },
                featureSet: {
                    "features": [],
                    "geometryType": "esriGeometryPoint"
                }
            };

			var popupTemplate = new esri.dijit.PopupTemplate({
                title: "User:{owner}",
                description: "Location:{latitude},{longitude}"
            });

            this.infoTemplate = new esri.InfoTemplate();
            this.infoTemplate.setTitle(function(graphic){
                return graphic.attributes.title;
            });

            this.infoTemplate.setContent(this.getWindowContent);
            
            this.featureLayer = new esri.layers.FeatureLayer(this.featureCollection, {
                id: 'flickrFeatureLayer',
                outFields: ["*"],
                name: "Flickr",
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
            
            this.name = "Flickr";
            
            this.loaded = true;
		},

		update: function(searchTerm){
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

			//remove existing Photos  
			if (this._map.infoWindow.isShowing) {
				this._map.infoWindow.hide();
			}
			if (this.featureLayer.graphics.length > 0) {
				this.featureLayer.applyEdits(null, null, this.featureLayer.graphics);
			}

			// clear data
			this.stats = {geoPoints:0,noGeo:0,geoNames:0};
			this.dataPoints = [];
			this.geocoded_ids = {};

			this.onClear();
		},

		getStats: function(){
			var x = this.stats;
			x.total = this.stats.geoPoints + this.stats.noGeo + this.stats.geoNames;
			return x;
		},
		
		getPoints: function(){
			return this.dataPoints;
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
		
		getExtent: function(){
			return esri.graphicsExtent(this.featureLayer.graphics);
		},
		
		getRadius: function(){
			var extent = this.extent || this._map.extent;
			return {radius:0,center:extent.getCenter(),units:"bbox"};
		},

		setSearchExtent: function(extent){
			this.extent = extent;
		},

		/*******************
		* Internal Methods
		*******************/

		getWindowContent: function(graphic) {
			//define content for the Flickr pop-up window.
			var photourl = "http://farm" + graphic.attributes.farm + ".static.flickr.com/" + graphic.attributes.server + "/" + graphic.attributes.id + "_" + graphic.attributes.secret + "_m.jpg";
			var content = "<table><tr><td><b>" + graphic.attributes.title + "</b></td></tr><tr><td><a href='" + photourl + "' target='_blank'><img style='max-height:160px;max-width:360px;' src='" + photourl + "'/></a></td></tr><tr><td>By: <a href='http://flickr.com/people/" + graphic.attributes.owner + "'>" + graphic.attributes.ownername + "</a></td></tr></table>";
			return content;
		},

		constructQuery: function(searchValue) {
			//limit is the number of results returned per page - max 50
			var limit = 50;

			var map = this._map;
			var extent = this.extent || map.extent;

			var baseurl = "http://api.flickr.com/services/rest/";
			var search = dojo.trim(searchValue);

			if (search.length === 0) {
				search = "";
			}

			var minPoint = esri.geometry.webMercatorToGeographic(new esri.geometry.Point(extent.xmin,extent.ymin, map.spatialReference));
			var maxPoint = esri.geometry.webMercatorToGeographic(new esri.geometry.Point(extent.xmax,extent.ymax, map.spatialReference));

			// by default, request Flickr pics going back one month
			var currentTime = new Date();
			var lastMonth = new Date();
			lastMonth.setDate(currentTime.getDate()-30);

			this.query = {
				min_taken_date: lastMonth.getFullYear() + "-" + (lastMonth.getMonth()*1 + 1) + "-" + lastMonth.getDate() + " 00:00:00",
				bbox: minPoint.x + "," + minPoint.y + "," + maxPoint.x + "," + maxPoint.y,
				accuracy: 6,
				extras: "geo,owner_name",
				per_page: limit,
				tags: search,
				method: "flickr.photos.search",
				api_key: "fe7e074f8dad46678841c585f38620b7",
				has_geo: 1,
				page: 1,
				format: "json"
			};

			//make the actual Flickr API call
			this.pageCount = 1;
			this.sendRequest(baseurl + "?" + dojo.objectToQuery(this.query));
		},

		sendRequest: function(url) {
			//get the results from Flickr for each page
			var deferred = esri.request({
				url: url,
				handleAs: "json",
				callbackParamName: "jsoncallback",
				load: dojo.hitch(this, function(data) {
					var res = this.unbindDef(deferred);
					if (data.photos.photo.length > 0) {
						this.mapResults(data);

						//display results for multiple pages
						if ((this.autopage) && (this.maxpage > this.pageCount) && (data.page < data.pages) && (this.query)) {
							this.pageCount++;
							this.query.page++;
							this.sendRequest("http://api.flickr.com/services/rest/?" + dojo.objectToQuery(this.query));
						}
						else{
							this.onUpdateEnd();
						}
					}
					else{
						// No results found, try another search term
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
			var k=j.photos.photo;
			dojo.forEach(k, dojo.hitch(this, function(result){
				// eliminate geo photos which we already have on the map
				if(this.geocoded_ids[result.id]){
					return
				}
				this.geocoded_ids[result.id] = true;
				var geoPoint = null;
				if(result.latitude){
					var g = [result.latitude,result.longitude];
					geoPoint=new esri.geometry.Point(parseFloat(g[1]),parseFloat(g[0]))
				}
				if(geoPoint){
					if (isNaN(geoPoint.x) || isNaN(geoPoint.y)) {
						this.stats.noGeo++;
					}
					else{				
						// convert the Point to WebMercator projection
						var a = new esri.geometry.geographicToWebMercator(geoPoint);
						// make the Point into a Graphic
						var attr = {};
						attr.owner = result.owner;
						attr.latitude = result.latitude;
						attr.longitude = result.longitude;
						attr.title = result.title;
						attr.id = result.id;
						attr.farm = result.farm;
						attr.server = result.server;
						attr.secret = result.secret;
						attr.ownername = result.ownername;
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

		/****************
         * Eventing
         ****************/

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