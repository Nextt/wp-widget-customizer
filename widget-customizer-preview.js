/*global jQuery, WidgetCustomizerPreview_exports, _ */
/*exported WidgetCustomizerPreview */
var WidgetCustomizerPreview = (function ($) {
	'use strict';

	var self = {
		rendered_sidebars: [],
		sidebars_eligible_for_post_message: {},
		rendered_widgets: [], // @todo only used once; not really needed as we can just loop over sidebars_widgets
		widgets_eligible_for_post_message: {},
		registered_sidebars: {},
		widget_selectors: [],
		render_widget_ajax_action: null,
		render_widget_nonce_value: null,
		render_widget_nonce_post_key: null,
		preview: null,
		i18n: {},

		init: function () {
			this.buildWidgetSelectors();
			this.highlightControls();
			this.livePreview();

			self.preview.bind( 'active', function() {
				self.preview.send( 'rendered-sidebars', self.rendered_sidebars );
			});
		},

		/**
		 * Calculate the selector for the sidebar's widgets based on the registered sidebar's info
		 */
		buildWidgetSelectors: function () {
			$.each( self.registered_sidebars, function ( id, sidebar ) {
				var widget_tpl = [
					sidebar.before_widget.replace('%1$s', '').replace('%2$s', ''),
					sidebar.before_title,
					sidebar.after_title,
					sidebar.after_widget
				].join('');
				var empty_widget = $(widget_tpl);
				var widget_selector = empty_widget.prop('tagName');
				var widget_classes = empty_widget.prop('className').replace(/^\s+|\s+$/g, '');
				if ( widget_classes ) {
					widget_selector += '.' + widget_classes.split(/\s+/).join('.');
				}
				self.widget_selectors.push(widget_selector);
			});
		},

		/**
		 *
		 */
		highlightControls: function() {

			var selector = this.widget_selectors.join(',');

			$(selector).attr( 'title', self.i18n.widget_tooltip );

			$(document).on( 'mouseenter', selector, function () {
				var control = parent.WidgetCustomizer.getWidgetFormControlForWidget( $(this).prop('id') );
				if ( control ) {
					control.highlightSectionAndControl();
				}
			});

			// Open expand the widget control when shift+clicking the widget element
			$(document).on( 'click', selector, function ( e ) {
				if ( ! e.shiftKey ) {
					return;
				}
				e.preventDefault();
				var control = parent.WidgetCustomizer.getWidgetFormControlForWidget( $(this).prop('id') );
				if ( control ) {
					control.expandControlSection();
					control.expandForm();
					control.container.find(':input:visible:first').focus();
				}
			});
		},

		/**
		 * if the containing sidebar is eligible, and if there are sibling widgets the sidebar currently rendered
		 * @param {String} sidebar_id
		 * @return {Boolean}
		 */
		sidebarCanLivePreview: function ( sidebar_id ) {
			if ( ! self.current_theme_supports ) {
				return false;
			}
			if ( ! self.sidebars_eligible_for_post_message[sidebar_id] ) {
				return false;
			}
			var widget_ids = wp.customize( sidebar_id_to_setting_id( sidebar_id ) )();
			var rendered_widget_ids = _( widget_ids ).filter( function ( widget_id ) {
				return 0 !== $( '#' + widget_id ).length;
			} );
			if ( rendered_widget_ids.length === 0 ) {
				return false;
			}
			return true;
		},


		/**
		 * We can only know if a sidebar can be live-previewed by letting the
		 * preview tell us, so this updates the parent's transports to
		 * postMessage when it is available. If there is a switch from
		 * postMessage to refresh, the preview window will request a refresh.
		 * @param {String} sidebar_id
		 */
		refreshTransports: function () {
			var changed_to_refresh = false;
			$.each( self.rendered_sidebars, function ( i, sidebar_id ) {
				var setting_id = sidebar_id_to_setting_id( sidebar_id );
				var setting = parent.wp.customize( setting_id );
				var sidebar_transport = self.sidebarCanLivePreview( sidebar_id ) ? 'postMessage' : 'refresh';
				if ( 'refresh' === sidebar_transport && 'postMessage' === setting.transport ) {
					changed_to_refresh = true;
				}
				setting.transport = sidebar_transport;

				var widget_ids = wp.customize( setting_id )();
				$.each( widget_ids, function ( i, widget_id ){
					var setting_id = widget_id_to_setting_id( widget_id );
					var setting = parent.wp.customize( setting_id );
					var widget_transport = 'refresh';
					var id_base = widget_id_to_base( widget_id );
					if ( self.current_theme_supports && sidebar_transport === 'postMessage' && self.widgets_eligible_for_post_message[id_base] ) {
						widget_transport = 'postMessage';
					}
					if ( 'refresh' === widget_transport && 'postMessage' === setting.transport ) {
						changed_to_refresh = true;
					}
					setting.transport = widget_transport;
				} );
			} );
			if ( changed_to_refresh ) {
				self.preview.send( 'refresh' );
			}
		},

		/**
		 *
		 */
		livePreview: function () {
			var already_bound_widgets = {};

			var bind_widget_setting = function( widget_id ) {
				var setting_id = widget_id_to_setting_id( widget_id );
				var binder = function( value ) {
					already_bound_widgets[widget_id] = true;
					var update_count = 0;
					value.bind( function( to, from ) {
						// Workaround for http://core.trac.wordpress.org/ticket/26061;
						// once fixed, eliminate initial_value, update_count, and this conditional
						update_count += 1;
						if ( 1 === update_count && _.isEqual( from, to ) ) {
							return;
						}

						var widget_setting_id = widget_id_to_setting_id( widget_id );
						if ( parent.wp.customize( widget_setting_id ).transport !== 'postMessage' ) {
							return;
						}

						var sidebar_id = null;
						var sidebar_widgets = [];
						wp.customize.each( function ( setting, setting_id ) {
							var matches = setting_id.match( /^sidebars_widgets\[(.+)\]/ );
							if ( matches && setting().indexOf( widget_id ) !== -1 ) {
								sidebar_id = matches[1];
								sidebar_widgets = setting();
							}
						} );
						if ( ! sidebar_id ) {
							throw new Error( 'Widget does not exist in a sidebar.' );
						}

						var data = {
							widget_customizer_render_widget: 1,
							action: self.render_widget_ajax_action,
							widget_id: widget_id,
							setting_id: setting_id,
							instance: JSON.stringify( to )
						};
						var customized = {};
						customized[ sidebar_id_to_setting_id( sidebar_id ) ] = sidebar_widgets;
						customized[setting_id] = to;
						data.customized = JSON.stringify(customized);
						data[self.render_widget_nonce_post_key] = self.render_widget_nonce_value;

						$.post( self.request_uri, data, function ( r ) {
							if ( ! r.success ) {
								throw new Error( r.data && r.data.message ? r.data.message : 'FAIL' );
							}

							// @todo Fire jQuery event to indicate that a widget was updated; here widgets can re-initialize them if they support live widgets
							var old_widget = $( '#' + widget_id );
							var new_widget = $( r.data.rendered_widget );
							if ( new_widget.length && old_widget.length ) {
								old_widget.replaceWith( new_widget );
							}
							else if ( ! new_widget.length && old_widget.length ) {
								old_widget.remove();
							}
							else if ( new_widget.length && ! old_widget.length ) {
								var sidebar_widgets = wp.customize( sidebar_id_to_setting_id( r.data.sidebar_id ) )();
								var position = sidebar_widgets.indexOf( widget_id );
								if ( -1 === position ) {
									throw new Error( 'Unable to determine new widget position in sidebar' );
								}
								if ( sidebar_widgets.length === 1 ) {
									throw new Error( 'Unexpected postMessage for adding first widget to sidebar; refresh must be used instead.' );
								}
								if ( position > 0 ) {
									var before_widget = $( '#' + sidebar_widgets[ position - 1 ] );
									before_widget.after( new_widget );
								}
								else {
									var after_widget = $( '#' + sidebar_widgets[ position + 1 ] );
									after_widget.before( new_widget );
								}
							}
							self.preview.send( 'widget-updated', widget_id );
							wp.customize.trigger( 'sidebar-updated', sidebar_id );
							wp.customize.trigger( 'widget-updated', widget_id );
							self.refreshTransports();
						} );
					} );
				};
				wp.customize( setting_id, binder );
				already_bound_widgets[setting_id] = binder;
			};

			$.each( self.rendered_sidebars, function ( i, sidebar_id ) {
				var setting_id = sidebar_id_to_setting_id( sidebar_id );
				wp.customize( setting_id, function( value ) {
					var update_count = 0;
					value.bind( function( to, from ) {
						// Workaround for http://core.trac.wordpress.org/ticket/26061;
						// once fixed, eliminate initial_value, update_count, and this conditional
						update_count += 1;
						if ( 1 === update_count && _.isEqual( from, to ) ) {
							return;
						}

						// Sort widgets
						// @todo instead of appending to the parent, we should append relative to the first widget found
						$.each( to, function ( i, widget_id ) {
							var widget = $( '#' + widget_id );
							widget.parent().append( widget );
						} );

						// Create settings for newly-created widgets
						$.each( to, function ( i, widget_id ) {
							var setting_id = widget_id_to_setting_id( widget_id );
							var setting = wp.customize( setting_id );
							if ( ! setting ) {
								setting = wp.customize.create( setting_id, {} );
							}

							// @todo Is there another way to check if we bound?
							if ( ! already_bound_widgets[widget_id] ) {
								bind_widget_setting( widget_id );
							}

							// Force the callback to fire if this widget is newly-added
							if ( from.indexOf( widget_id ) === -1 ) {
								self.refreshTransports();
								var parent_setting = parent.wp.customize( setting_id );
								if ( 'postMessage' === parent_setting.transport ) {
									setting.callbacks.fireWith( setting, [ setting(), null ] );
								} else {
									self.preview.send( 'refresh' );
								}
							}
						} );

						// Remove widgets (their DOM element and their setting) when removed from sidebar
						$.each( from, function ( i, old_widget_id ) {
							if ( -1 === to.indexOf( old_widget_id ) ) {
								var setting_id = widget_id_to_setting_id( old_widget_id );
								if ( wp.customize.has( setting_id ) ) {
									wp.customize.remove( setting_id );
									// @todo WARNING: If a widget is moved to another sidebar, we need to either not do this, or force a refresh when a widget is  moved to another sidebar
								}
								$( '#' + old_widget_id ).remove();
							}
						} );

						// If a widget was removed so that no widgets remain rendered in sidebar, we need to disable postMessage
						self.refreshTransports();
						wp.customize.trigger( 'sidebar-updated', sidebar_id );
					} );
				} );
			} );

			// @todo We don't really need rendered_widgets; we can just loop over all sidebars_widgets, and get all their widget_ids
			$.each( self.rendered_widgets, function ( widget_id ) {
				var setting_id = widget_id_to_setting_id( widget_id );
				if ( ! wp.customize.has( setting_id ) ) {
					// Used to have to do this: wp.customize.create( setting_id, instance );
					// Now that the settings are registered at the `wp` action, it is late enough
					// for all filters to be added, e.g. sidebars_widgets for Widget Visibility
					throw new Error( 'Expected customize to have registered setting for widget ' + widget_id );
				}
				bind_widget_setting( widget_id );
			} );

			// Opt-in to LivePreview
			self.refreshTransports();
		}
	};

	$.extend(self, WidgetCustomizerPreview_exports);

	/**
	 * Capture the instance of the Preview since it is private
	 */
	var OldPreview = wp.customize.Preview;
	wp.customize.Preview = OldPreview.extend( {
		initialize: function( params, options ) {
			self.preview = this;
			OldPreview.prototype.initialize.call( this, params, options );
		}
	} );

	/**
	 * @param {String} widget_id
	 * @returns {String}
	 */
	function widget_id_to_setting_id( widget_id ) {
		var setting_id = null;
		var matches = widget_id.match(/^(.+?)(?:-(\d+)?)$/);
		if ( matches ) {
			setting_id = 'widget_' + matches[1] + '[' + matches[2] + ']';
		}
		else {
			setting_id = 'widget_' + widget_id;
		}
		return setting_id;
	}

	/**
	 * @param {String} widget_id
	 * @returns {String}
	 */
	function widget_id_to_base( widget_id ) {
		return widget_id.replace( /-\d+$/, '' );
	}

	/**
	 * @param {String} sidebar_id
	 * @returns {string}
	 */
	function sidebar_id_to_setting_id( sidebar_id ) {
		return 'sidebars_widgets[' + sidebar_id + ']';
	}

	$(function () {
		self.init();
	});

	return self;
}( jQuery ));
