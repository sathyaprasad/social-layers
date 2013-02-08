dojo.provide("social.youtube");

dojo.require("esri.map");
dojo.require("esri.geometry");
dojo.require("esri.layers.FeatureLayer");
dojo.require("esri.dijit.Popup");

dojo.addOnLoad(function() {

	dojo.declare("social.youtube", null, {

		// Doc: http://docs.dojocampus.org/dojo/declare#chaining
		"-chains-": {
			constructor: "manual"
		},

		constructor: function( options ) {
			this._map = options.map || null;			
			if (this._map === null) {
				throw "social.youtube says: Reference to esri.Map object required";
			}
			
			this.autopage = options.autopage || true;
			this.maxpage = options.maxpage || 5;

			//create feature layer for YouTube videos
           this.featureCollection = {
                layerDefinition: {
                    "geometryType": "esriGeometryPoint",
                    "drawingInfo": {
                        "renderer": {
                            "type": "simple",
                            "symbol": {
                                "type": "esriPMS",
                                "url": "images/youtube-point-16x20.png",
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
                        "name": "published",
                        "type": "esriFieldTypeDate",
                        "alias": "Created"
                    }, {
                        "name": "updated",
                        "type": "esriFieldTypeDate",
                        "alias": "Updated"
                    }, {
                        "name": "id",
                        "type": "esriFieldTypeString",
                        "alias": "id",
                        "length": 100
                    }, {
                        "name": "description",
                        "type": "esriFieldTypeString",
                        "alias": "description",
                        "length": 500
                    }, {
                        "name": "author",
                        "type": "esriFieldTypeString",
                        "alias": "Author",
                        "length": 100
                    }, {
                        "name": "thumbnail",
                        "type": "esriFieldTypeString",
                        "alias": "Thumbnail",
                        "length": 100
                    }, {
                        "name": "location",
                        "type": "esriFieldTypeString",
                        "alias": "Location",
                        "length": 1073741822
                    }, {
                        "name": "src",
                        "type": "esriFieldTypeString",
                        "alias": "Source",
                        "length": 100
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
                title: "User:{author[0].name.$t}",
                description: "Location:{georss$where.gml$Point.gml$pos.$t}"
            });

            this.infoTemplate = new esri.InfoTemplate();
            this.infoTemplate.setTitle(function(graphic){
                return graphic.attributes.author;
            });

            this.infoTemplate.setContent(this.getWindowContent);
            
            this.featureLayer = new esri.layers.FeatureLayer(this.featureCollection, {
                id: 'youtubeFeatureLayer',
                outFields: ["*"],
                name: "Youtube",
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

		update: function(searchTerm){
			this.clear();
			this.constructQuery(searchTerm);
		},

        pointToExtent: function(map, point, toleranceInPixel){
            var pixelWidth = map.extent.getWidth() / map.width;
            var toleraceInMapCoords = toleranceInPixel * pixelWidth;
            return new esri.geometry.Extent(point.x - toleraceInMapCoords, point.y - toleraceInMapCoords, point.x + toleraceInMapCoords, point.y + toleraceInMapCoords, map.spatialReference);
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

		clear: function() {
			//cancel any outstanding requests
			this.query = null;
			dojo.forEach(this.deferreds, function(def) { 
				def.cancel();
			});
			if(this.deferreds){
				this.deferreds.length = 0;
			}

			//remove existing videos  
			if (this._map.infoWindow.isShowing) {
				this._map.infoWindow.hide();
			}
			if (this.featureLayer.graphics.length > 0) {
				this.featureLayer.applyEdits(null, null, this.featureLayer.graphics);
			}

			// clear data and stats
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
		
		getExtent: function(){
			return esri.graphicsExtent(this.featureLayer.graphics);
		},
		
		getRadius: function(){
			var map = this._map;
			var extent = this.extent || map.extent;
			var radius = Math.min(621, Math.ceil(esri.geometry.getLength( new esri.geometry.Point(extent.xmin,extent.ymin, map.spatialReference), new esri.geometry.Point(extent.xmax,extent.ymin, map.spatialReference) ) * 3.281 / 5280 / 2) );
			return {radius:radius,center:extent.getCenter(),units:"mi"};
		},

		setSearchExtent: function(extent){
			this.extent = extent;
		},

		/*******************
		* Internal Methods
		*******************/

		getWindowContent: function(graphic) {
			//define content for the pop-up window.
			var reg_exp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/i;
			var curtailed = graphic.attributes.description;
			if(curtailed.length > 140){
				curtailed = curtailed.substring(0,140) + " ....";				
			}
			var linkedText = curtailed.replace(reg_exp, "<br/><a href='$1' target='_blank'>$1</a><br/>");
			var content = "<table><tr><td><b>" + graphic.attributes.title + "</b></td></tr><tr><td><a title='Click to view video' target='_blank' href='" + graphic.attributes.src + "'><img align='left' style='margin:0 5px 5px 0;width:90px;height:60px;' class='round shadow' src='" + graphic.attributes.thumbnail + "'/></a>" + linkedText +  "</td></tr><tr><td>From: " + graphic.attributes.author+"</td></tr></table>";
			return content;
		},

		constructQuery: function(searchValue) {
			//limit is the number of results returned per page - max 50
			var limit = "50";

			//specify search radius - has to be smaller than 1500 kilometers (932 miles)
			//by default, use a radius equal to half the width of the bottom border of the map
			var map = this._map;
			var extent = this.extent || map.extent;
			var radius = this.getRadius().radius;

			var baseurl = "http://gdata.youtube.com/feeds/api/videos";
			var search = dojo.trim(searchValue);

			if (search.length === 0) {
				search = "";
			}

			var center = extent.getCenter();
			center = esri.geometry.webMercatorToGeographic(center);

			this.query = {
				q: search,
				"max-results": limit,
				v: 2,
				location: center.y + "," + center.x,
				"location-radius": radius + "mi",
				time: "this_month",
				"start-index": 1,
				alt: "json"
			};

			//make the actual YouTube API call
			this.pageCount = 0;
			this.sendRequest(baseurl + "?" + dojo.objectToQuery(this.query));
		},

		sendRequest: function(url) {
			//get the results from YouTube for each page
			var deferred = esri.request({
				url: url,
				handleAs: "json",
				callbackParamName: "callback",
				load: dojo.hitch(this, function(data) {
					var res = this.unbindDef(deferred);
					if (data.feed.entry && data.feed.entry.length > 0) {
						this.mapResults(data);
						//display results from multiple pages
						if ((this.autopage) && (this.maxpage > this.pageCount) && (data.feed.entry.length >= 50)&&(this.query)){
							this.pageCount++;
							this.query["start-index"] += 50;
							this.sendRequest("http://gdata.youtube.com/feeds/api/videos?" + dojo.objectToQuery(this.query));
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
				error: dojo.hitch(this, function(e) {
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
			var k=j.feed.entry;
			dojo.forEach(k, dojo.hitch(this, function(result){
				// eliminate video ids which we already have on the map
				if(this.geocoded_ids[result.id.$t]){
					return
				}
				this.geocoded_ids[result.id.$t] = true;
				var geoPoint = null;
				if(result.georss$where){
					if(result.georss$where.gml$Point){
						if(result.georss$where.gml$Point.gml$pos){
							var g = result.georss$where.gml$Point.gml$pos.$t.split(' ');
							geoPoint=new esri.geometry.Point(parseFloat(g[1]),parseFloat(g[0]))
						}
					}
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
						attr.location = result.georss$where.gml$Point.gml$pos.$t;
						attr.id = result.id.$t;
						attr.title = result.title.$t;
						attr.published = result.published.$t;
						attr.updated = result.updated.$t;
						attr.src = result.link[0].href;
						attr.description = result.media$group.media$description.$t;
						attr.thumbnail = result.media$group.media$thumbnail[0].url;
						attr.author = result.author[0].name.$t;
						
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

		onUpdate: function(){
		},

		onUpdateEnd: function(){
		},

		onError: function(info){
		}

	}); // end of class declaration
  
}); // end of addOnLoad