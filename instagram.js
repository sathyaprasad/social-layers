define(
	[
		"dojo/_base/declare",
		"dojo/_base/connect",
		"dojo/_base/array",
		"dojo/_base/lang",
		"dojo/_base/event",
		"esri/layers/FeatureLayer",		
		"esri/tasks/query",
		"esri/geometry",
		"esri/graphic",
		"esri/graphicsUtils",
		"esri/InfoTemplate",
		"esri/request"
	],
	function (declare, dojoConnect, dojoArray, dojoLang, dojoEvent, FeatureLayer, Query, Geometry, Graphic, GraphicsUtils, InfoTemplate, esri_Request) {	
	return declare('modules.instagram',[], {
		declaredClass: 'modules.instagram',
		constructor : function (options) {
			this.options = {
				map : null,
				baseUrl : 'https://api.instagram.com/v1',
				clientId : null,
				autopage : true,
				maxpage : 5,
				limit : 100,
				id : 'instagramLayer',
				symbolUrl : '',
				symbolHeight : 22.5,
				symbolWidth : 18.75,
				popupHeight : 280,
				popupWidth : 260,
				popupTitle : 'Instagram'
			};

			declare.safeMixin(this.options, options);

			if (this.options.map === null) {
				throw 'Instagram: Reference to esri.Map object required';
			}

			if (this.options.clientId === null) {
				throw 'Instagram: clientId in options required';
			}

			if (this.options.symbolUrl === null) {
				throw 'Instagram: symbolUrl in options required';
			}

			this.featureCollection = this._getFeatureCollectionTemplate();

			//Setup infotempalte for popup
			//this.infoTemplate = new esri.InfoTemplate();
			this.infoTemplate = new InfoTemplate();
			this.infoTemplate.setTitle(dojoLang.hitch(this, function (graphic) {
					return this.options.popupTitle;
				}));
			this.infoTemplate.setContent(this._getWindowContent);

			//setup the associated feature layer for storage, query and display
			//this.featureLayer = new esri.layers.FeatureLayer(this.featureCollection, {
			this.featureLayer = new FeatureLayer(this.featureCollection, {
					id : this.options.id,
					outFields : ["*"],
					infoTemplate : this.infoTemplate,
					visible : true
				});

			//add the featurelayer to the map
			this.options.map.addLayer(this.featureLayer);

			//dojoConnect the click event on the instagram map icons
			dojoConnect.connect(this.featureLayer, "onClick", dojoLang.hitch(this, function (evt) {
					dojoEvent.stop(evt);
					//var query = new esri.tasks.Query();
					var query = new Query();
					query.geometry = this._pointToExtent(this.options.map, evt.mapPoint, this.options.symbolWidth);
					//var deferred = this.featureLayer.selectFeatures(query, esri.layers.FeatureLayer.SELECTION_NEW);
					var deferred = this.featureLayer.selectFeatures(query, FeatureLayer.SELECTION_NEW);
					this.options.map.infoWindow.setFeatures([deferred]);
					this.options.map.infoWindow.show(evt.mapPoint);
					this.options.map.infoWindow.resize(this.options.popupWidth, this.options.popupHeight);
					this.onClick(evt);
				}));

			this.stats = {
				geo : 0,
				noGeo : 0
			};

			this.geocoded_ids = [];
			this.pageCount = 0;
			//this.dataPoints = [];
			//this.deferreds = [];
			this.loaded = true;
		},

		//public methods
		clear : function () {
			// cancel any outstanding requests
			this.query = null;
			if (this.deferred) {
				this.deferred.cancel();
			}

			if (this.options.map.infoWindow.isShowing) {
				this.options.map.infoWindow.hide();
			}
			if (this.featureLayer.graphics.length > 0) {
				this.featureLayer.applyEdits(null, null, this.featureLayer.graphics);
			}
			//clear stats
			this.stats = {
				geo : 0,
				noGeo : 0
			};
			this.geocoded_ids = [];
			//this.dataPoints = [];
			this.pageCount = 0;
			this.onClear();
		},
		getStats : function () {
			var x = this.stats;
			x.total = this.stats.geo + this.stats.noGeo;
			return x;
		},
		//*********
		//feature layer helpers
		//*********
		show : function () {
			this.featureLayer.setVisibility(true);
		},
		hide : function () {
			this.featureLayer.setVisibility(false);
		},
		getExtent : function () {
			if(this.featureLayer.graphics.length == 0) {
				return null;
			} else if(this.featureLayer.graphics.length == 1) {
				return this._pointToExtent(this.options.map, this.featureLayer.graphics[0].geometry, this.options.symbolWidth);
			} else {
				//return esri.graphicsExtent(this.featureLayer.graphics);
				return GraphicsUtils.graphicsExtent(this.featureLayer.graphics);
			}			
			
			//return this.featureLayer.graphics.length ? esri.graphicsExtent(this.featureLayer.graphics) : null;
		},
		zoomTo : function () {
			var ext = this.getExtent();
			if (ext) {
				this.options.map.setExtent(ext, true);
			}
		},
		//*********
		//instagram api abstractions
		//*********
		//1. Geo search using map center
		search : function (count) {
			var center = this.options.map.extent.getCenter();
			var options = {
				count : count || 100,
				lat : center.getLatitude(),
				lng : center.getLongitude(),
				distance : 5000
			};
			this._sendRequest(this.options.baseUrl + "/media/search/", options);
		},
		//2. search by tags
		searchByTags : function (tags /* array of search tags */
		, count) {
			if (tags && (tags instanceof Array) && tags.length > 0) {
				var options = {
					q : tags.toString(),
					count : count || 100
				};
				this._sendRequest(this.options.baseUrl + "/tags/search/", options);
			} else {
				this.onError("Instagram: search array of tags not provided");
				return;
			}
		},
		//3. search popular photos
		popular : function (count) {
			var options = {
				count : count || 100
			};
			this._sendRequest(this.options.baseUrl + "/media/popular");
		},
		//4. search recent items by a userid
		recentByUser : function (userid, count) {
			if (!userid) {
				this.onError("Instagram: userid not provided");
				return;
			}
			var options = {
				count : count || 100
			};
			this._sendRequest(this.options.baseUrl + "/users/" + userid + "/media/recent", options);
		},
		//5. search recents itme by a tag
		recentByTag : function (tagname /*string*/
		, count) {
			if (!tagname || tagname.length < 1) {
				this.onError("Instagram: tagname not provided");
				return;
			}
			var options = {
				count : count || 100
			};
			this._sendRequest(this.options.baseUrl + "/tags/" + tagname + "/media/recent", options);
		},
		//*********
		//private
		//*********
		_sendRequest : function (url, options) {
			console.log(url);
			console.log("page count: " + this.pageCount);
			if (this.pageCount < 1) {
				this.onUpdateStart();
			}
			var params = {
				"client_id" : this.options.clientId
			};
			declare.safeMixin(params, options);
			if (this.deferred) {
				console.log("esri_Request being cancelled");
				this.deferred.cancel();
			}
			//this.deferred = esri.request({
			this.deferred = esri_Request({
					url : url,
					handleAs : "json",
					timeout : 10000,
					callbackParamName : "callback",
					content : params
				});
			this.deferred.then(dojoLang.hitch(this, this._onSuccess), dojoLang.hitch(this, this._onError));
			//this.deferreds.push(deferred);
		},
		_onSuccess : function (result) {
			console.log("** Success: Got something back from Instagram **");
			console.log(result);
			if (result.meta && result.meta.code !== 200) {
				console.log("Instagram: API Meta code is not 200");
				this.onError(result.meta.error_message || "API error");
				return;
			}
			var data = result.data;
			var pagination = result.pagination;

			delete this.deferred;

			if (data && data.length > 0) {
				console.log("found " + data.length + " items");
				this._mapResults(data);
				if (pagination && pagination.next_url) {
					this.pageCount++;
					// display results for multiple pages
					if ((this.options.autopage) && (this.options.maxpage > this.pageCount)) {
						this._sendRequest(pagination.next_url);
					} else {
						this.onUpdateEnd();
					}
				} else {
					// No more pages
					this.onUpdateEnd();
				}
			} else {
				// No results found
				this.onUpdateEnd();
			}

		},
		_onError : function (e) {
			console.log("** Error: No Results from Instagram **");
			console.log('Search error' + ": " + e.message.toString());
			this.onError(e);
		},
		_mapResults : function (data) {
			//console.log("inside map results");
			var graphics = [];
			
			dojoArray.forEach(data, dojoLang.hitch(this, function (item) {
					console.log(item);
					// eliminate duplicate geo photos
					if (this.geocoded_ids[item.id]) {
						console.log("duplicate item " + item.id);
						return;
					}

					this.geocoded_ids[item.id] = true;
										
					 // The 0 there is the key, which sets the date to the epoch					

					if (item.location && parseFloat(item.location.latitude) && parseFloat(item.location.longitude)) {
						this.stats.geo++;
						//var pt = new esri.geometry.Point(parseFloat(item.location.longitude), parseFloat(item.location.latitude));
						var pt = new Geometry.Point(parseFloat(item.location.longitude), parseFloat(item.location.latitude));
						var attr = {
							"photo_link" : item.images.low_resolution.url || item.images.low_resolution,
							"photo_thumbnail" : item.images.thumbnail.url || item.images.thumbnail,
							"id" : item.id,
							"location_name" : item.location.name || null,
							"location_latitude" : item.location.latitude,
							"location_longitude" : item.location.longitude,
							"likes_count" : item.likes ? item.likes.count : null,
							"link" : item.link,
							"attribution" : item.attribution || "",
							"created_time" :  item.created_time,
							"caption_text" : item.caption ? item.caption.text : "No caption",
							"user_profile_name" : item.user.full_name || "Anonymous",
							"user_profile_picture" : item.user.profile_picture
						};
						// make the Point into a Graphic and add it to the array of graphics
						//var pt_wm = new esri.geometry.geographicToWebMercator(pt);
						var pt_wm = new Geometry.webMercatorUtils.geographicToWebMercator(pt);
						//var graphic = new esri.Graphic(pt_wm);
						var graphic = new Graphic(pt_wm);
						graphic.setAttributes(attr);
						graphics.push(graphic);
					} else {
						//no lat,lon available so cannot add to the map
						this.stats.noGeo++;
						return;
					}

				}));
			//update feature layer at one with all the graphics
			this.featureLayer.applyEdits(graphics, null, null);
			this.onUpdate();
		},
		_getWindowContent : function (graphic) {
			//console.log(graphic);
			var attr = graphic.attributes;
			console.log(attr);
			var dateToStore = new Date();
			dateToStore.setTime(attr.created_time*1000);
			var html = '';
			html += '<div class="instagram">';
			html += '<span class="caption">' + attr.caption_text + '</span>';
			html += '<hr style="height:1px;">';
			html += '<img src="' + attr.photo_thumbnail + '"/>';
			html += '<br>';	
			html += '<span class="likes">Likes: ' + attr.likes_count + '</span>';
			html += '<hr style="height:1px;">';						
			html += '<span class="user"><img align="right" src="' + attr.user_profile_picture + '" style="width:36px;height:36px; padding-left:5px;border-radius:5px;" alt=""/>' + attr.user_profile_name + '</span>';
			html += '<br>';			
			html += '<span class="created">Posted: ' + dateToStore.toDateString() + '</span>';
			html += '<br>';			
			if(attr.location_name) {
				html += '<span class="location">Location: ' + attr.location_name + '</span>';			
			} else {
				html += '<span class="location">Lat: ' + attr.location_latitude.toFixed(2) + " | Lon: " + attr.location_longitude.toFixed(2) + '</span>';			
			}
			html += '</div>';			
			return html;
		},
		_prettyDate : function (val) {
			var date = null;
			
			if (typeof val == "number") {
				date = new Date(val);
			} else {		
				date = new Date((val || "").replace(/-/g, "/").replace(/[TZ]/g, " "));
			}

			if (isNaN(date.getTime())) {
				date = new Date(val || "");
			}

			var diff = (((new Date()).getTime() - date.getTime()) / 1000),
			day_diff = Math.floor(diff / 86400);

			if (isNaN(day_diff) || day_diff < 0) {
				return;
			}

			return (day_diff === 0 && (diff < 10 && "just now" || diff < 20 && "10 secs ago" || diff < 30 && "20 secs ago" || diff < 40 && "30 secs ago" || diff < 90 && "1 minute ago" || diff < 3600 && Math.floor(diff / 60) + " minutes ago" || diff < 7200 && "1 hour ago" || diff < 86400 && Math.floor(diff / 3600) + " hours ago") || day_diff == 1 && "Yesterday" || day_diff < 7 && day_diff + " days ago" || day_diff < 31 && Math.ceil(day_diff / 7) + " weeks ago" || day_diff < 365 && Math.ceil(day_diff / 30) + " months ago" || "more than a year ago");

		},
		_replaceURLWithLinks : function (text) {
			var reg_exp = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/i;
			return text.replace(reg_exp, "<a href='$1' target='_blank'>$1</a>");
		},
		_pointToExtent : function (map, point, toleranceInPixel) {
			var pixelWidth = map.extent.getWidth() / map.width;
			var toleraceInMapCoords = toleranceInPixel * pixelWidth;
			//return new esri.geometry.Extent(point.x - toleraceInMapCoords, point.y - toleraceInMapCoords, point.x + toleraceInMapCoords, point.y + toleraceInMapCoords, map.spatialReference);
			return new Geometry.Extent(point.x - toleraceInMapCoords, point.y - toleraceInMapCoords, point.x + toleraceInMapCoords, point.y + toleraceInMapCoords, map.spatialReference);
		},
		_parseURL : function (text) {
			return text.replace(/[A-Za-z]+:\/\/[A-Za-z0-9-_]+\.[A-Za-z0-9-_:%&~\?\/.=]+/g, function (url) {
				return ' < a target = "_blank" href = "' + url + '" > ' + url + ' <  / a > ';
			});
		},
		_getFeatureCollectionTemplate : function () {
			return {
				layerDefinition : {
					"geometryType" : "esriGeometryPoint",
					"drawingInfo" : {
						"renderer" : {
							"type" : "simple",
							"symbol" : {
								"type" : "esriPMS",
								"url" : this.options.symbolUrl,
								"contentType" : "image/" + this.options.symbolUrl.substring(this.options.symbolUrl.lastIndexOf(".") + 1),
								"width" : this.options.symbolWidth,
								"height" : this.options.symbolHeight
							}
						}
					},
					"fields" : [{
							"name" : "OBJECTID",
							"type" : "esriFieldTypeOID"
						}, {
							"name" : "id",
							"type" : "esriFieldTypeString",
							"alias" : "Photo_Id"
						}, {
							"name" : "created_time",
							"type" : "esriFieldTypeString", //esriFieldTypeDate
							"alias" : "Created"
						}, {
							"name" : "likes_count",
							"type" : "esriFieldTypeInteger",
							"alias" : "Likes"
						}, {
							"name" : "link",
							"type" : "esriFieldTypeString",
							"alias" : "Link"
						}, {
							"name" : "attribution",
							"type" : "esriFieldTypeString",
							"alias" : "Attribution"
						}, {
							"name" : "location_latitude",
							"type" : "esriFieldTypeDouble",
							"alias" : "Latitude"
						}, {
							"name" : "location_longitude",
							"type" : "esriFieldTypeDouble",
							"alias" : "Longitude"
						}, {
							"name" : "location_name",
							"type" : "esriFieldTypeDouble",
							"alias" : "Location"
						}, {
							"name" : "photo_link",
							"type" : "esriFieldTypeString",
							"alias" : "Photo"
						}, {
							"name" : "photo_thumbnail",
							"type" : "esriFieldTypeString",
							"alias" : "Thumbnail"
						}, {
							"name" : "caption_text",
							"type" : "esriFieldTypeString",
							"alias" : "Caption"
						}, {
							"name" : "user_profile_name",
							"type" : "esriFieldTypeString",
							"alias" : "User"
						}, {
							"name" : "user_profile_picture",
							"type" : "esriFieldTypeString",
							"alias" : "Profile"
						}
					],
					"globalIdField" : "id",
					"displayField" : "id"
				},
				featureSet : {
					"features" : [],
					"geometryType" : "esriGeometryPoint"
				}
			}
		},

		//public events
		onError : function (msg) {
			return new Error(msg);
		},
		onUpdateStart : function () {},
		onUpdateEnd : function () {},
		onUpdate : function () {},
		onClear : function () {},
		onClick : function () {}
	});
});
