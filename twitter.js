dojo.provide("social.twitter");

dojo.require("esri.map");
dojo.require("esri.geometry");
dojo.require("esri.layers.FeatureLayer");
dojo.require("esri.dijit.Popup");

dojo.addOnLoad(function(){

	dojo.declare("social.twitter", null, {
    
		// Doc: http://docs.dojocampus.org/dojo/declare#chaining
		"-chains-": {
			constructor: "manual"
		},

		constructor: function(options){
			this._map = options.map || null;			
			if (this._map === null) {
				throw "social.twitter says: Reference to esri.Map object required";
			}
			
			this.autopage = options.autopage || true;
			this.maxpage = options.maxpage || 5;

			//create feature layer for Tweets
           this.featureCollection = {
                layerDefinition: {
                    "geometryType": "esriGeometryPoint",
                    "drawingInfo": {
                        "renderer": {
                            "type": "simple",
                            "symbol": {
                                "type": "esriPMS",
                                "url": "images/twitter-point-16x20.png",
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
                        "name": "created_at",
                        "type": "esriFieldTypeDate",
                        "alias": "Created"
                    }, {
                        "name": "id",
                        "type": "esriFieldTypeString",
                        "alias": "id",
                        "length": 100
                    }, {
                        "name": "from_user",
                        "type": "esriFieldTypeString",
                        "alias": "User",
                        "length": 100
                    }, {
                        "name": "location",
                        "type": "esriFieldTypeString",
                        "alias": "Location",
                        "length": 1073741822
                    }, {
                        "name": "place",
                        "type": "esriFieldTypeString",
                        "alias": "Place",
                        "length": 100
                    }, {
                        "name": "text",
                        "type": "esriFieldTypeString",
                        "alias": "Text",
                        "length": 1073741822
                    }, {
                        "name": "profile_image_url",
                        "type": "esriFieldTypeString",
                        "alias": "ProfileImage",
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
                title: "User:{from_user}",
                description: "Location:{location}"
            });
            
            this.infoTemplate = new esri.InfoTemplate();
            this.infoTemplate.setTitle(function(graphic){
                return graphic.attributes.from_user;
            });

            this.infoTemplate.setContent(this.getWindowContent);
            
            this.featureLayer = new esri.layers.FeatureLayer(this.featureCollection, {
                id: 'twitterFeatureLayer',
                outFields: ["*"],
                name: "Twitter",
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
            
            this.name = "Twitter";

            this.loaded = true;
		},
        
		/*****************
		* Public Methods
		*****************/     
        
		update: function(searchTerm){  
			this.clear();
            this.constructQuery(searchTerm);
        },
		
        pointToExtent: function(map, point, toleranceInPixel){
            var pixelWidth = map.extent.getWidth() / map.width;
            var toleraceInMapCoords = toleranceInPixel * pixelWidth;
            return new esri.geometry.Extent(point.x - toleraceInMapCoords, point.y - toleraceInMapCoords, point.x + toleraceInMapCoords, point.y + toleraceInMapCoords, map.spatialReference);
        },

		getStats: function(){
			var x = this.stats;
			x.total = this.stats.geoPoints + this.stats.noGeo + this.stats.geoNames;
			return x;
		},
		
		getPoints: function(){
			return this.dataPoints;
		},
        
        clear: function(){
            //cancel any outstanding requests
			this.continueQuery = false;
            dojo.forEach(this.deferreds, function(def){
                def.cancel();
            });
            if (this.deferreds) {
                this.deferreds.length = 0;
            }
            
            //remove existing tweets  
            if (this._map.infoWindow.isShowing) {
                this._map.infoWindow.hide();
            }
            if (this.featureLayer.graphics.length > 0) {
                this.featureLayer.applyEdits(null, null, this.featureLayer.graphics);
            }
            
            // clear stats and points
            this.stats = {
                geoPoints: 0,
                noGeo: 0,
				geoNames: 0
            };
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
		
		getExtent: function(){
			return esri.graphicsExtent(this.featureLayer.graphics);
		},
		
        getRadius: function(){
			var map = this._map;
            var extent = this.extent || map.extent;
            var radius = Math.min(932, Math.ceil(esri.geometry.getLength(new esri.geometry.Point(extent.xmin, extent.ymin, map.spatialReference), new esri.geometry.Point(extent.xmax, extent.ymin, map.spatialReference)) * 3.281 / 5280 / 2));
            radius = Math.round(radius, 0);
            return {
                radius: radius,
                center: map.extent.getCenter(),
                units: "mi"
            };
        },
		
		setSearchExtent: function(extent){
			this.extent = extent;
		},

		/*******************
		* Internal Methods
		*******************/

        getWindowContent: function(graphic){
            //define content for the tweet pop-up window.
            var reg_exp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/i;
            var tweetText = graphic.attributes.text.replace(reg_exp, "<br/><a href='$1' target='_blank'>$1</a><br/>");
            var content = "<table><tr><td valign='top'><img align='left' style='margin:0 5px 5px 0;' class='round shadow' src='" + graphic.attributes.profile_image_url + "' width='64' height='64' /><b>" + graphic.attributes.from_user + ":</b><br/>" + tweetText + "</td></tr></table>";
            
            return content;
        },

		constructQuery: function(searchValue){
			//limit is the number of results returned per page - max 100
			//maximum number of results that can be returned are 1500.
			var limit = "100";

			//specify search radius - has to be smaller than 1500 kilometers (932 miles) and 
			//greater than 1 meter
			//radius is half the width of the bottom border of the map
			var map = this._map;
			var radius = this.getRadius().radius;

			var baseurl = "http://search.twitter.com/search.json";
			var search = dojo.trim(searchValue);

			if (search.length === 0) {
				search = "";
			}

            var extent = this.extent || map.extent;

			var center = extent.getCenter();
			center = esri.geometry.webMercatorToGeographic(center);
			
			var d1= new Date();
			var since_secs = (d1.getTime()-d1.getMilliseconds()) - (5*24*60*60*1000)

            var query = {
				q: search,
				rpp: limit,
				since_id: since_secs,
				result_type: "mixed",
				geocode: center.y + "," + center.x + "," + radius + "mi"
			};

			//start Twitter API call of several pages
			this.continueQuery = true;
			this.pageCount = 1;
			this.sendRequest(baseurl + "?" + dojo.objectToQuery(query));
		},

		sendRequest: function(url){
			//get the results from twitter for each page
			var deferred = esri.request({
				url: url,
				handleAs: "json",
				
				timeout: 10000,
				callbackParamName: "callback",
				
				preventCache: false,
				load: dojo.hitch(this, function(data){
					var res = this.unbindDef(deferred);
					if (data.results.length > 0) {
						this.mapResults(data);

						//display results for multiple pages
						if ((this.autopage) && (this.maxpage > this.pageCount) && (data.next_page !== undefined) && (this.continueQuery)) {
							this.pageCount++;
							this.sendRequest("http://search.twitter.com/search.json" + data.next_page)
						}
						else{
							this.onUpdateEnd();
						}
					}
					else {
						// No results found, try another search term
						this.onUpdateEnd();
					}
				}),
				error: dojo.hitch(this, function(e){
					if (deferred.canceled) {
						console.log("Search Cancelled");
					}
					else {
						console.log("Search error : " + e.message);
						var res = this.unbindDef(deferred);
					}
					this.onError(e);
				})
			});

			this.deferreds.push(deferred);
		},

		unbindDef: function(dfd){
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
			if (j.error) {
				console.log("mapResults error: " + j.error);
				this.onError(j.error);
				return
			}
			var b = [];
			var k = j.results;
			dojo.forEach(k, dojo.hitch(this, function(result){
				// eliminate Tweets which we have on the map
				if (this.geocoded_ids[result.id]) {
					return
				}
				this.geocoded_ids[result.id] = true;
				var geoPoint = null;
				if(result.geo) {
					var g = result.geo.coordinates;
					geoPoint = new esri.geometry.Point(parseFloat(g[1]), parseFloat(g[0]))
				}
				else {
					var n = result.location;
					if(n){
						// try some different parsings for result.location
						if (n.indexOf("iPhone:") > -1) {
							n = n.slice(7);
							var f = n.split(",");
							geoPoint = new esri.geometry.Point(parseFloat(f[1]), parseFloat(f[0]))
						}
						else if (n.indexOf("�T") > -1) {
							n = n.slice(3);
							var e = n.split(",");
							geoPoint = new esri.geometry.Point(parseFloat(e[1]), parseFloat(e[0]))
						}
						else if (n.indexOf("T") == 1) {
							n = n.slice(3);
							var e = n.split(",");
							geoPoint = new esri.geometry.Point(parseFloat(e[1]), parseFloat(e[0]))
						}
						else if (n.indexOf("Pre:") > -1) {
							n = n.slice(4);
							var d = n.split(",");
							geoPoint = new esri.geometry.Point(parseFloat(d[1]), parseFloat(d[0]));
						}
						else if (n.split(",").length == 2) {
							var c = n.split(",");
							if (c.length == 2 && parseFloat(c[1]) && parseFloat(c[0])) {
								geoPoint = new esri.geometry.Point(parseFloat(c[1]), parseFloat(c[0]));
							}
							else {
								// location cannot be interpreted by this geocoder
								this.stats.geoNames++;
								return;
							}
						}
						else {
							// location cannot be interpreted by this geocoder
							this.stats.geoNames++;
							return;
						}
					}
					else{
						// location cannot be interpreted by this geocoder
						this.stats.geoNames++;
						return;
					}
				}
				if (geoPoint) {
					//last check to make sure we parsed it right
					if (isNaN(geoPoint.x) || isNaN(geoPoint.y)) {
						//discard bad geopoints
						this.stats.noGeo++;
					}
					else {
						// convert the Point to WebMercator projection
						var a = new esri.geometry.geographicToWebMercator(geoPoint);
						// make the Point into a Graphic
						var attr = {};
						attr.from_user = result.from_user;
						attr.location = result.location;
						attr.text = result.text;
						attr.id = result.id;
						attr.profile_image_url = result.profile_image_url;
						attr.created_at = result.created_at;
						attr.place = "";
						if (result.place) {							
							attr.place = result.place.full_name || "";
						}
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
                else {
                    this.stats.noGeo++;
                }
			}));
			
			this.featureLayer.applyEdits(b, null, null);
			
			this.onUpdate();
		},

		/****************
		* Miscellaneous
		****************/

		onUpdate: function(){		
		},

		onUpdateEnd: function(){		
		},

		onClear: function(){
		},

        onError: function(info){
        }

	}); // end of class declaration
}); // end of addOnLoad