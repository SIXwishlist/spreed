/* global Marionette, Backbone, OCA */

/**
 * @author Christoph Wurst <christoph@winzerhof-wurst.at>
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

(function(OC, OCA, Marionette, Backbone, _, $) {
	'use strict';

	OCA.Talk = OCA.Talk || {};

	var roomChannel = Backbone.Radio.channel('rooms');

	OCA.Talk.Application = Marionette.Application.extend({
		OWNER: 1,
		MODERATOR: 2,
		USER: 3,
		GUEST: 4,
		USERSELFJOINED: 5,

		/** @property {OCA.SpreedMe.Models.Room} activeRoom  */
		activeRoom: null,

		/** @property {String} token  */
		token: null,

		/** @property {OCA.Talk.Connection} connection  */
		connection: null,

		/** @property {OCA.Talk.Signaling.base} signaling  */
		signaling: null,

		/** @property {OCA.SpreedMe.Models.RoomCollection} _rooms  */
		_rooms: null,
		/** @property {OCA.SpreedMe.Views.RoomListView} _roomsView  */
		_roomsView: null,
		/** @property {OCA.SpreedMe.Models.ParticipantCollection} _participants  */
		_participants: null,
		/** @property {OCA.SpreedMe.Views.ParticipantView} _participantsView  */
		_participantsView: null,
		/** @property {boolean} videoWasEnabledAtLeastOnce  */
		videoWasEnabledAtLeastOnce: false,
		displayedGuestNameHint: false,
		audioDisabled: localStorage.getItem("audioDisabled"),
		audioNotFound: false,
		videoDisabled: localStorage.getItem("videoDisabled"),
		videoNotFound: false,
		fullscreenDisabled: true,
		_searchTerm: '',
		guestNick: null,
		_currentEmptyContent: null,
		_lastEmptyContent: null,
		_registerPageEvents: function() {
			$('#select-participants').select2({
				ajax: {
					url: OC.linkToOCS('apps/files_sharing/api/v1') + 'sharees',
					dataType: 'json',
					quietMillis: 100,
					data: function (term) {
						this._searchTerm = term;
						return {
							format: 'json',
							search: term,
							perPage: 20,
							itemType: 'call'
						};
					},
					results: function (response) {
						// TODO improve error case
						if (response.ocs.data === undefined) {
							console.error('Failure happened', response);
							return;
						}

						var results = [];

						$.each(response.ocs.data.exact.users, function(id, user) {
							if (OC.getCurrentUser().uid === user.value.shareWith) {
								return;
							}
							results.push({ id: user.value.shareWith, displayName: user.label, type: "user"});
						});
						$.each(response.ocs.data.exact.groups, function(id, group) {
							results.push({ id: group.value.shareWith, displayName: group.label + ' ' + t('spreed', '(group)'), type: "group"});
						});
						$.each(response.ocs.data.users, function(id, user) {
							if (OC.getCurrentUser().uid === user.value.shareWith) {
								return;
							}
							results.push({ id: user.value.shareWith, displayName: user.label, type: "user"});
						});
						$.each(response.ocs.data.groups, function(id, group) {
							results.push({ id: group.value.shareWith, displayName: group.label + ' ' + t('spreed', '(group)'), type: "group"});
						});

						//Add custom entry to create a new empty group or public room
						if (OCA.SpreedMe.app._searchTerm === '') {
							results.unshift({ id: "create-public-room", displayName: t('spreed', 'New public conversation'), type: "createPublicRoom"});
							results.unshift({ id: "create-group-room", displayName: t('spreed', 'New group conversation'), type: "createGroupRoom"});
						} else {
							results.push({ id: "create-group-room", displayName: t('spreed', 'New group conversation'), type: "createGroupRoom"});
							results.push({ id: "create-public-room", displayName: t('spreed', 'New public conversation'), type: "createPublicRoom"});
						}

						return {
							results: results,
							more: false
						};
					}
				},
				initSelection: function (element, callback) {
					callback({id: element.val()});
				},
				formatResult: function (element) {
					if ((element.type === "createGroupRoom") || (element.type === "createPublicRoom")) {
						return '<span><div class="avatar icon-add"></div>' + escapeHTML(element.displayName) + '</span>';
					}

					return '<span><div class="avatar" data-user="' + escapeHTML(element.id) + '" data-user-display-name="' + escapeHTML(element.displayName) + '"></div>' + escapeHTML(element.displayName) + '</span>';
				},
				formatSelection: function () {
					return '<span class="select2-default" style="padding-left: 0;">' + t('spreed', 'New conversation …') + '</span>';
				}
			});

			$('#select-participants').on("click", function() {
				$('.select2-drop').find('.avatar').each(function () {
					var element = $(this);
					if (element.data('user-display-name')) {
						element.avatar(element.data('user'), 32, undefined, false, undefined, element.data('user-display-name'));
					} else {
						element.avatar(element.data('user'), 32);
					}
				});
			});

			$('#select-participants').on("select2-selecting", function(e) {
				switch (e.object.type) {
					case "user":
						this.connection.createOneToOneVideoCall(e.val);
						break;
					case "group":
						this.connection.createGroupVideoCall(e.val, "");
						break;
					case "createPublicRoom":
						this.connection.createPublicVideoCall(OCA.SpreedMe.app._searchTerm);
						break;
					case "createGroupRoom":
						this.connection.createGroupVideoCall("", OCA.SpreedMe.app._searchTerm);
						break;
					default:
						console.log("Unknown type", e.object.type);
						break;
				}
			}.bind(this));

			$('#select-participants').on("select2-loaded", function() {
				$('.select2-drop').find('.avatar').each(function () {
					var element = $(this);
					if (element.data('user-display-name')) {
						element.avatar(element.data('user'), 32, undefined, false, undefined, element.data('user-display-name'));
					} else {
						element.avatar(element.data('user'), 32);
					}
				});
			});

			// Initialize button tooltips
			$('[data-toggle="tooltip"]').tooltip({trigger: 'hover'}).click(function() {
				$(this).tooltip('hide');
			});

			$('#hideVideo').click(function() {
				if(!OCA.SpreedMe.app.videoWasEnabledAtLeastOnce) {
					// don't allow clicking the video toggle
					// when no video ever was streamed (that
					// means that permission wasn't granted
					// yet or there is no video available at
					// all)
					console.log('video can not be enabled - there was no stream available before');
					return;
				}
				if ($(this).hasClass('video-disabled')) {
					OCA.SpreedMe.app.enableVideo();
					localStorage.removeItem("videoDisabled");
				} else {
					OCA.SpreedMe.app.disableVideo();
					localStorage.setItem("videoDisabled", true);
				}
			});

			$('#mute').click(function() {
				if (OCA.SpreedMe.webrtc.webrtc.isAudioEnabled()) {
					OCA.SpreedMe.app.disableAudio();
					localStorage.setItem("audioDisabled", true);
				} else {
					OCA.SpreedMe.app.enableAudio();
					localStorage.removeItem("audioDisabled");
				}
			});

			$('#video-fullscreen').click(function() {
				if (this.fullscreenDisabled) {
					this.enableFullscreen();
				} else {
					this.disableFullscreen();
				}
			}.bind(this));

			$('#screensharing-button').click(function() {
				var webrtc = OCA.SpreedMe.webrtc;
				if (!webrtc.capabilities.supportScreenSharing) {
					if (window.location.protocol === 'https:') {
						OC.Notification.showTemporary(t('spreed', 'Screensharing is not supported by your browser.'));
					} else {
						OC.Notification.showTemporary(t('spreed', 'Screensharing requires the page to be loaded through HTTPS.'));
					}
					return;
				}

				if (webrtc.getLocalScreen()) {
					$('#screensharing-menu').toggleClass('open');
				} else {
					var screensharingButton = $(this);
					screensharingButton.prop('disabled', true);
					webrtc.shareScreen(function(err) {
						screensharingButton.prop('disabled', false);
						if (!err) {
							$('#screensharing-button').attr('data-original-title', t('spreed', 'Screensharing options'))
								.removeClass('screensharing-disabled icon-screen-off')
								.addClass('icon-screen');
							return;
						}

						switch (err.name) {
							case "HTTPS_REQUIRED":
								OC.Notification.showTemporary(t('spreed', 'Screensharing requires the page to be loaded through HTTPS.'));
								break;
							case "PERMISSION_DENIED":
							case "NotAllowedError":
							case "CEF_GETSCREENMEDIA_CANCELED":  // Experimental, may go away in the future.
								break;
							case "FF52_REQUIRED":
								OC.Notification.showTemporary(t('spreed', 'Sharing your screen only works with Firefox version 52 or newer.'));
								break;
							case "EXTENSION_UNAVAILABLE":
								var  extensionURL = null;
								if (!!window.chrome && !!window.chrome.webstore) {// Chrome
									extensionURL = 'https://chrome.google.com/webstore/detail/screensharing-for-nextclo/kepnpjhambipllfmgmbapncekcmabkol';
								}

								if (extensionURL) {
									var text = t('spreed', 'Screensharing extension is required to share your screen.');
									var element = $('<a>').attr('href', extensionURL).attr('target','_blank').text(text);

									OC.Notification.showTemporary(element, {isHTML: true});
								} else {
									OC.Notification.showTemporary(t('spreed', 'Please use a different browser like Firefox or Chrome to share your screen.'));
								}
								break;
							default:
								OC.Notification.showTemporary(t('spreed', 'An error occurred while starting screensharing.'));
								console.log("Could not start screensharing", err);
								break;
						}
					});
				}
			});

			$("#show-screen-button").on('click', function() {
				var currentUser = OCA.SpreedMe.webrtc.connection.getSessionid();
				OCA.SpreedMe.sharedScreens.switchScreenToId(currentUser);

				$('#screensharing-menu').toggleClass('open', false);
			});

			$("#stop-screen-button").on('click', function() {
				OCA.SpreedMe.webrtc.stopScreenShare();
			});

			$(document).keyup(this._onKeyUp.bind(this));
		},

		_onKeyUp: function(event) {
			// Define which objects to check for the event properties.
			var key = event.which;

			// Trigger the event only if no input or textarea is focused
			// and the CTRL key is not pressed
			if ($('input:focus').length === 0 &&
				$('textarea:focus').length === 0 &&
				$('div[contenteditable=true]:focus').length === 0 &&
				!event.ctrlKey) {

				// Actual shortcut handling
				switch (key) {
					case 86: // 'v'
						event.preventDefault();
						if (this.videoDisabled) {
							this.enableVideo();
						} else {
							this.disableVideo();
						}
						break;
					case 77: // 'm'
						event.preventDefault();
						if (this.audioDisabled) {
							this.enableAudio();
						} else {
							this.disableAudio();
						}
						break;
					case 70: // 'f'
						event.preventDefault();
						if (this.fullscreenDisabled) {
							this.enableFullscreen();
						} else {
							this.disableFullscreen();
						}
						break;
					case 67: // 'c'
						event.preventDefault();
						this._sidebarView.selectTab('chat');
						break;
					case 80: // 'p'
						event.preventDefault();
						this._sidebarView.selectTab('participants');
						break;
				}
			}
		},

		_showRoomList: function() {
			this._roomsView = new OCA.SpreedMe.Views.RoomListView({
				el: '#app-navigation ul',
				collection: this._rooms
			});
		},
		_showParticipantList: function() {
			this._participants = new OCA.SpreedMe.Models.ParticipantCollection();
			this._participantsView = new OCA.SpreedMe.Views.ParticipantView({
				room: this.activeRoom,
				collection: this._participants,
				id: 'participantsTabView'
			});

			this.signaling.on('usersInRoom', function() {
				// Also refresh the participant list when the users change
				this._participants.fetch();
			}.bind(this));

			this._participantsView.listenTo(this._rooms, 'change:active', function(model, active) {
				if (active) {
					this.setRoom(model);
				}
			});

			this._sidebarView.addTab('participants', { label: t('spreed', 'Participants'), icon: 'icon-contacts-dark' }, this._participantsView);
		},
		/**
		 * @param {string} token
		 */
		_setRoomActive: function(token) {
			if (OC.getCurrentUser().uid) {
				this._rooms.forEach(function(room) {
					room.set('active', room.get('token') === token);
				});
			}
		},
		addParticipantToRoom: function(token, participant) {
			$.post(
				OC.linkToOCS('apps/spreed/api/v1/room', 2) + token + '/participants',
				{
					newParticipant: participant
				}
			).done(function() {
				this.signaling.syncRooms();
			}.bind(this));
		},
		syncAndSetActiveRoom: function(token) {
			var self = this;
			this.signaling.syncRooms()
				.then(function() {
					self.stopListening(self.activeRoom, 'change:participantInCall');

					if (OC.getCurrentUser().uid) {
						roomChannel.trigger('active', token);

						self._rooms.forEach(function(room) {
							if (room.get('token') === token) {
								self.activeRoom = room;
							}
						});
					} else {
						// The public page supports only a single room, so the
						// active room is already the room for the given token.

						self.setRoomMessageForGuest(self.activeRoom.get('participants'));
					}
					// Disable video when entering a room with more than 5 participants.
					if (Object.keys(self.activeRoom.get('participants')).length > 5) {
						self.disableVideo();
					}

					self.setPageTitle(self.activeRoom.get('displayName'));

					self.updateChatViewPlacement();
					self.listenTo(self.activeRoom, 'change:participantInCall', self.updateChatViewPlacement);

					self.updateSidebarWithActiveRoom();
				});
		},
		updateChatViewPlacement: function() {
			if (!this.activeRoom) {
				// This should never happen, but just in case
				return;
			}

			if (this.activeRoom.get('participantInCall') && this._chatViewInMainView === true) {
				this._chatView.saveScrollPosition();
				this._chatView.$el.detach();
				this._sidebarView.addTab('chat', { label: t('spreed', 'Chat'), icon: 'icon-comment', priority: 100 }, this._chatView);
				this._sidebarView.selectTab('chat');
				this._chatView.restoreScrollPosition();
				this._chatView.setTooltipContainer(this._chatView.$el);
				this._chatViewInMainView = false;
			} else if (!this.activeRoom.get('participantInCall') && !this._chatViewInMainView) {
				this._chatView.saveScrollPosition();
				this._sidebarView.removeTab('chat');
				this._chatView.$el.prependTo('#app-content-wrapper');
				this._chatView.restoreScrollPosition();
				this._chatView.setTooltipContainer($('#app'));
				this._chatView.focusChatInput();
				this._chatViewInMainView = true;
			}
		},
		updateSidebarWithActiveRoom: function() {
			this._sidebarView.enable();

			// The sidebar has a width of 27% of the window width and a minimum
			// width of 300px. Therefore, when the window is 1111px wide or
			// narrower the sidebar will always be 300px wide, and when that
			// happens it will overlap with the content area (the narrower the
			// window the larger the overlap). Due to this the sidebar is opened
			// automatically only if it will not overlap with the content area.
			if ($(window).width() > 1111) {
				this._sidebarView.open();
			}

			var callInfoView = new OCA.SpreedMe.Views.CallInfoView({
				model: this.activeRoom,
				guestNameModel: this._localStorageModel
			});
			this._sidebarView.setCallInfoView(callInfoView);

			this._messageCollection.setRoomToken(this.activeRoom.get('token'));
			this._messageCollection.receiveMessages();
		},
		setPageTitle: function(title){
			if (title) {
				title += ' - ';
			} else {
				title = '';
			}
			title += t('spreed', 'Talk');
			title += ' - ' + oc_defaults.title;
			window.document.title = title;
		},
		/**
		 *
		 * @param {string|Object} icon
		 * @param {string} icon.userId
		 * @param {string} icon.displayName
		 * @param {string} message
		 * @param {string} [messageAdditional]
		 * @param {string} [url]
		 */
		setEmptyContentMessage: function(icon, message, messageAdditional, url) {
			var $icon = $('#emptycontent-icon'),
				$emptyContent = $('#emptycontent');

			//Remove previous icon and avatar from emptycontent
			$icon.removeAttr('class').attr('class', '');
			$icon.html('');

			if (url) {
				$('#shareRoomInput').removeClass('hidden').val(url);
				$('#shareRoomClipboardButton').removeClass('hidden');
			} else {
				$('#shareRoomInput').addClass('hidden');
				$('#shareRoomClipboardButton').addClass('hidden');
			}

			if (typeof icon === 'string') {
				$icon.addClass(icon);
			} else {
				var $avatar = $('<div>');
				$avatar.addClass('avatar room-avatar');
				if (icon.userId !== icon.displayName) {
					$avatar.avatar(icon.userId, 128, undefined, false, undefined, icon.displayName);
				} else {
					$avatar.avatar(icon.userId, 128);
				}
				$icon.append($avatar);
			}

			$emptyContent.find('h2').html(message);
			$emptyContent.find('p').text(messageAdditional ? messageAdditional : '');
			this._lastEmptyContent = this._currentEmptyContent;
			this._currentEmptyContent = arguments;
		},
		restoreEmptyContent: function() {
			this.setEmptyContentMessage.apply(this, this._lastEmptyContent);
		},
		setRoomMessageForGuest: function(participants) {
			if (Object.keys(participants).length === 1) {
				var participantId = '',
					participantName = '';

				_.each(participants, function(data, userId) {
					if (OC.getCurrentUser().uid !== userId) {
						participantId = userId;
						participantName = data.name;
					}
				});

				OCA.SpreedMe.app.setEmptyContentMessage(
					{ userId: participantId, displayName: participantName},
					t('spreed', 'Waiting for {participantName} to join the call …', {participantName: participantName})
				);

			} else {
				OCA.SpreedMe.app.setEmptyContentMessage('icon-contacts-dark', t('spreed', 'Waiting for others to join the call …'));
			}
		},
		initialize: function() {
			this._sidebarView = new OCA.SpreedMe.Views.SidebarView();
			$('#app-content').append(this._sidebarView.$el);

			if (OC.getCurrentUser().uid) {
				this._rooms = new OCA.SpreedMe.Models.RoomCollection();
				this.listenTo(roomChannel, 'active', this._setRoomActive);
			} else {
				this.initGuestName();
			}

			this._sidebarView.listenTo(roomChannel, 'leaveCurrentCall', function() {
				this.disable();
			});

			this._messageCollection = new OCA.SpreedMe.Models.ChatMessageCollection(null, {token: null});
			this._chatView = new OCA.SpreedMe.Views.ChatView({
				collection: this._messageCollection,
				id: 'commentsTabView',
				guestNameModel: this._localStorageModel
			});

			this._messageCollection.listenTo(roomChannel, 'leaveCurrentCall', function() {
				this.stopReceivingMessages();
			});

			$(document).on('click', this.onDocumentClick);
			OC.Util.History.addOnPopStateHandler(_.bind(this._onPopState, this));
		},
		onStart: function() {
			this.signaling = OCA.Talk.Signaling.createConnection();
			this.connection = new OCA.Talk.Connection(this);
			this.token = $('#app').attr('data-token');

			$(window).unload(function () {
				this.connection.leaveCurrentRoom(false);
				this.signaling.disconnect();
			}.bind(this));

			if (OC.getCurrentUser().uid) {
				this._showRoomList();
				this.signaling.setRoomCollection(this._rooms)
					.then(function(data) {
						$('#app-navigation').removeClass('icon-loading');
						this._roomsView.render();

						if (data.length === 0) {
							$('#select-participants').select2('open');
						}
					}.bind(this));

				this._showParticipantList();
			} else {
				// The token is always defined in the public page.
				this.activeRoom = new OCA.SpreedMe.Models.Room({ token: this.token });
				this.signaling.setRoom(this.activeRoom);
			}

			this._registerPageEvents();
			this.initShareRoomClipboard();

			if (this.token) {
				this.connection.joinRoom(this.token);
			}
		},
		setupWebRTC: function() {
			if (!OCA.SpreedMe.webrtc) {
				OCA.SpreedMe.initWebRTC(this);
			}
		},
		startLocalMedia: function(configuration) {
			$('.videoView').removeClass('hidden');
			this.initAudioVideoSettings(configuration);
			this.restoreEmptyContent();
		},
		startWithoutLocalMedia: function(isAudioEnabled, isVideoEnabled) {
			$('.videoView').removeClass('hidden');

			this.disableAudio();
			if (!isAudioEnabled) {
				this.hasNoAudio();
			}

			this.disableVideo();
			if (!isVideoEnabled) {
				this.hasNoVideo();
			}
		},
		_onPopState: function(params) {
			if (!_.isUndefined(params.token)) {
				this.connection.joinRoom(params.token);
			}
		},
		onDocumentClick: function(event) {
			var uiChannel = Backbone.Radio.channel('ui');

			uiChannel.trigger('document:click', event);
		},
		initAudioVideoSettings: function(configuration) {
			if (this.audioDisabled) {
				this.disableAudio();
			}

			if (configuration.video !== false) {
				if (this.videoDisabled) {
					this.disableVideo();
				}
			} else {
				this.videoWasEnabledAtLeastOnce = false;
				this.disableVideo();
			}
		},
		enableFullscreen: function() {
			var fullscreenElem = document.getElementById('app-content');

			if (fullscreenElem.requestFullscreen) {
				fullscreenElem.requestFullscreen();
			} else if (fullscreenElem.webkitRequestFullscreen) {
				fullscreenElem.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
			} else if (fullscreenElem.mozRequestFullScreen) {
				fullscreenElem.mozRequestFullScreen();
			} else if (fullscreenElem.msRequestFullscreen) {
				fullscreenElem.msRequestFullscreen();
			}
			$('#video-fullscreen').attr('data-original-title', t('spreed', 'Exit fullscreen (f)'));

			this.fullscreenDisabled = false;
		},
		disableFullscreen: function() {

			if (document.exitFullscreen) {
				document.exitFullscreen();
			} else if (document.webkitExitFullscreen) {
				document.webkitExitFullscreen();
			} else if (document.mozCancelFullScreen) {
				document.mozCancelFullScreen();
			} else if (document.msExitFullscreen) {
				document.msExitFullscreen();
			}
			$('#video-fullscreen').attr('data-original-title', t('spreed', 'Fullscreen (f)'));

			this.fullscreenDisabled = true;
		},
		enableAudio: function() {
			if (this.audioNotFound || !OCA.SpreedMe.webrtc) {
				return;
			}

			OCA.SpreedMe.webrtc.unmute();
			$('#mute').attr('data-original-title', t('spreed', 'Mute audio (m)'))
				.removeClass('audio-disabled icon-audio-off')
				.addClass('icon-audio');

			this.audioDisabled = false;
		},
		disableAudio: function() {
			if (this.audioNotFound || !OCA.SpreedMe.webrtc) {
				return;
			}

			OCA.SpreedMe.webrtc.mute();
			$('#mute').attr('data-original-title', t('spreed', 'Unmute audio (m)'))
				.addClass('audio-disabled icon-audio-off')
				.removeClass('icon-audio');

			this.audioDisabled = true;
		},
		hasNoAudio: function() {
			$('#mute').removeClass('audio-disabled icon-audio')
				.addClass('no-audio-available icon-audio-off')
				.attr('data-original-title', t('spreed', 'No audio'));
			this.audioDisabled = true;
			this.audioNotFound = true;
		},
		enableVideo: function() {
			if (this.videoNotFound || !OCA.SpreedMe.webrtc) {
				return;
			}

			var $hideVideoButton = $('#hideVideo');
			var $audioMuteButton = $('#mute');
			var $screensharingButton = $('#screensharing-button');
			var avatarContainer = $hideVideoButton.closest('.videoView').find('.avatar-container');
			var localVideo = $hideVideoButton.closest('.videoView').find('#localVideo');

			OCA.SpreedMe.webrtc.resumeVideo();
			$hideVideoButton.attr('data-original-title', t('spreed', 'Disable video (v)'))
				.removeClass('video-disabled icon-video-off')
				.addClass('icon-video');
			$audioMuteButton.removeClass('video-disabled');
			$screensharingButton.removeClass('video-disabled');

			avatarContainer.hide();
			localVideo.show();

			this.videoDisabled = false;
		},
		hideVideo: function() {
			var $hideVideoButton = $('#hideVideo');
			var $audioMuteButton = $('#mute');
			var $screensharingButton = $('#screensharing-button');
			var avatarContainer = $hideVideoButton.closest('.videoView').find('.avatar-container');
			var localVideo = $hideVideoButton.closest('.videoView').find('#localVideo');

			if (!$hideVideoButton.hasClass('no-video-available')) {
				$hideVideoButton.attr('data-original-title', t('spreed', 'Enable video (v)'))
					.addClass('video-disabled icon-video-off')
					.removeClass('icon-video');
				$audioMuteButton.addClass('video-disabled');
				$screensharingButton.addClass('video-disabled');
			}

			var avatar = avatarContainer.find('.avatar');
			var guestName = localStorage.getItem("nick");
			if (OC.getCurrentUser().uid) {
				avatar.avatar(OC.getCurrentUser().uid, 128);
			} else {
				avatar.imageplaceholder('?', guestName, 128);
				avatar.css('background-color', '#b9b9b9');
				if (this.displayedGuestNameHint === false) {
					OC.Notification.showTemporary(t('spreed', 'You can set your name on the right sidebar so other participants can identify you better.'));
					this.displayedGuestNameHint = true;
				}
			}

			avatarContainer.removeClass('hidden');
			avatarContainer.show();
			localVideo.hide();
		},
		disableVideo: function() {
			if (this.videoNotFound || !OCA.SpreedMe.webrtc) {
				return;
			}

			OCA.SpreedMe.webrtc.pauseVideo();
			this.hideVideo();
			this.videoDisabled = true;
		},
		hasNoVideo: function() {
			$('#hideVideo').removeClass('icon-video')
				.addClass('no-video-available icon-video-off')
				.attr('data-original-title', t('spreed', 'No Camera'));
			this.videoDisabled = true;
			this.videoNotFound = true;
		},
		disableScreensharingButton: function() {
			$('#screensharing-button').attr('data-original-title', t('spreed', 'Enable screensharing'))
					.addClass('screensharing-disabled icon-screen-off')
					.removeClass('icon-screen');
			$('#screensharing-menu').toggleClass('open', false);
		},
		initGuestName: function() {
			var self = this;
			this._localStorageModel = new OCA.SpreedMe.Models.LocalStorageModel({ nick: '' });
			this._localStorageModel.on('change:nick', function(model, newDisplayName) {
				$.ajax({
					url: OC.linkToOCS('apps/spreed/api/v1/guest', 2) + this.token + '/name',
					type: 'POST',
					data: {
						displayName: newDisplayName
					},
					beforeSend: function (request) {
						request.setRequestHeader('Accept', 'application/json');
					},
					success: function() {
						self._onChangeGuestName(newDisplayName);
					}
				});
			}.bind(this));

			this._localStorageModel.fetch();
		},
		_onChangeGuestName: function(newDisplayName) {
			var avatar = $('#localVideoContainer').find('.avatar');

			avatar.imageplaceholder('?', newDisplayName, 128);
			avatar.css('background-color', '#b9b9b9');

			if (OCA.SpreedMe.webrtc) {
				console.log('_onChangeGuestName.webrtc');
				OCA.SpreedMe.webrtc.sendDirectlyToAll('status', 'nickChanged', newDisplayName);
			}
		},
		initShareRoomClipboard: function () {
			$('body').find('.shareRoomClipboard').tooltip({
				placement: 'bottom',
				trigger: 'hover',
				title: t('core', 'Copy')
			});

			var clipboard = new Clipboard('.shareRoomClipboard');
			clipboard.on('success', function(e) {
				var $input = $(e.trigger);
				$input.tooltip('hide')
					.attr('data-original-title', t('core', 'Copied!'))
					.tooltip('fixTitle')
					.tooltip({placement: 'bottom', trigger: 'manual'})
					.tooltip('show');
				_.delay(function() {
					$input.tooltip('hide')
						.attr('data-original-title', t('core', 'Copy'))
						.tooltip('fixTitle');
				}, 3000);
			});
			clipboard.on('error', function (e) {
				var $input = $(e.trigger);
				var actionMsg = '';
				if (/iPhone|iPad/i.test(navigator.userAgent)) {
					actionMsg = t('core', 'Not supported!');
				} else if (/Mac/i.test(navigator.userAgent)) {
					actionMsg = t('core', 'Press ⌘-C to copy.');
				} else {
					actionMsg = t('core', 'Press Ctrl-C to copy.');
				}

				$input.tooltip('hide')
					.attr('data-original-title', actionMsg)
					.tooltip('fixTitle')
					.tooltip({placement: 'bottom', trigger: 'manual'})
					.tooltip('show');
				_.delay(function () {
					$input.tooltip('hide')
						.attr('data-original-title', t('spreed', 'Copy'))
						.tooltip('fixTitle');
				}, 3000);
			});
		}
	});

})(OC, OCA, Marionette, Backbone, _, $);
