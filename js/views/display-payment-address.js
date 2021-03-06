var app = app || {};

app.views = app.views || {};

app.views.DisplayPaymentAddress = (function() {

	'use strict';

	return app.abstracts.BaseView.extend({

		className: 'display-payment-address',

		template: '#template-pay-address',

		events: {
			'quicktouch .cancel': 'cancel',
			'quicktouch .back': 'back',
		},

		timerForTimeOut: null,

		listenerTimeOut: null,

		serializeData: function() {

			return {
				amount: {
					display: {
						value: this.options.amount,
						currency: app.settings.get('displayCurrency')
					},
					crypto: {
						ref: this.options.method,
						currency: app.paymentMethods[this.options.method].code,
					}
				}
			};
		},

		onRender: function() {

			this.$address = this.$('.address');
			this.$addressQrCode = this.$('.address-qr-code');
			this.$addressText = this.$('.address-text');
			this.$cryptoAmount = this.$('.crypto.amount');
			this.updateCryptoAmount();
		},

		updateCryptoAmount: function() {

			var displayCurrency = app.settings.get('displayCurrency');
			var paymentMethod = app.paymentMethods[this.options.method];
			var displayAmount = this.options.amount;

			app.busy();

			var done = function() {
				app.busy(false);
			};

			if (displayCurrency === paymentMethod.code) {
				// Don't need to convert, because the payment method is the display currency.
				this.renderCryptoAmount(displayAmount);
				this.updateQrCode(displayAmount, null, null, done);
			} else {
				// Convert the display amount to the real amount in the desired cryptocurrency.
				paymentMethod.convertAmount(displayAmount, displayCurrency, _.bind(function(error, amount, displayCurrencyExchangeRate, displayCurrency) {

					if (error) {
						this.resetQrCode();
						return app.mainView.showMessage(error);
					}

					this.renderCryptoAmount(amount);
					this.updateQrCode(amount, displayCurrencyExchangeRate, displayCurrency, done);

				}, this));
			}
		},

		renderQrCode: function(data, done) {

			var width = Math.min(
				this.$address.width(),
				this.$address.height()
			);

			app.util.renderQrCode(this.$addressQrCode/* $target */, data, {
				width: width,
			}, function(error) {

				done && done();

				if (error) {
					return app.mainView.showMessage(error);
				}
			});
		},

		renderAddress: function(address) {

			this.$addressText.text(address);
		},

		renderCryptoAmount: function(amount) {

			var displayCurrency = app.settings.get('displayCurrency');
			var paymentMethod = app.paymentMethods[this.options.method];
			var formattedAmount = app.util.formatNumber(amount, {
				paymentMethod: paymentMethod.ref,
			});
			this.$cryptoAmount.find('.amount-value').text(formattedAmount);
			this.$cryptoAmount.toggleClass('visible', displayCurrency !== paymentMethod.code);
		},

		resetQrCode: function() {

			this.$addressQrCode.empty();
			this.$addressText.empty();
		},

		updateQrCode: function(amount, displayCurrencyExchangeRate, displayCurrency, done) {

			var paymentMethod = app.paymentMethods[this.options.method];

			paymentMethod.generatePaymentRequest(amount, _.bind(function(error, paymentRequest) {

				if (error) {
					this.resetQrCode();
					return app.mainView.showMessage(error);
				}

				this.renderQrCode(paymentRequest.uri, done);
				this.renderAddress(paymentRequest.address);
				this.paymentRequestUri = paymentRequest.uri;

				this._createPaymentRequestTimeout = _.delay(_.bind(function() {
					app.paymentRequests.add({
						currency: paymentMethod.code,
						address: paymentRequest.address,
						amount: paymentRequest.amount,
						displayCurrency: {
							code: displayCurrency,
							rate: displayCurrencyExchangeRate
						},
						data: paymentRequest.data || {},
						status: 'pending',
					}).save().then(_.bind(function(attributes) {
						this.paymentRequest = app.paymentRequests.get(attributes.id);
						this.startListeningForPayment();
					}, this));
				}, this), 5000);

			}, this));
		},

		startListeningForPayment: function() {

			if (!this.paymentRequest) return;

			var paymentMethod = app.paymentMethods[this.options.method];
			var paymentRequest = this.paymentRequest.toJSON();
			var received = false;
			var timedOut = false;
			var errorWhileWaiting;

			paymentMethod.listenForPayment(paymentRequest, function(error, wasReceived) {
				if (error) {
					errorWhileWaiting = error;
				} else {
					received = wasReceived === true;
				}
			});

			var done = _.bind(function(error) {

				this.stopListeningForPayment();

				if (error) {
					return app.mainView.showMessage(error);
				}

				if (received) {
					// Update the status of the payment request.
					this.paymentRequest.save({ status: 'unconfirmed' });
					// Show success screen.
					app.router.navigate('confirmed', { trigger: true });
				} else {
					// Update the status of the payment request.
					this.paymentRequest.save({ status: 'timed-out' });
					// Show timed-out screen.
					app.router.navigate('timed-out', { trigger: true });
				}

			}, this);

			var iteratee = _.bind(function(next) {

				if (errorWhileWaiting) {
					return next(errorWhileWaiting);
				} else {
					this.listenerTimeOut = _.delay(next, 100);
				}
			}, this);

			this.timerForTimeOut = setTimeout(function() {
				timedOut = true;
			}, app.config.paymentRequest.timedOut)

			async.until(function() { return received || timedOut; }, iteratee, done);
		},

		stopListeningForPayment: function() {

			var paymentMethod = app.paymentMethods[this.options.method];
			paymentMethod.stopListeningForPayment();
			clearTimeout(this.listenerTimeOut);
			clearTimeout(this.timerForTimeOut);
		},

		cancel: function(evt) {

			if (evt && evt.preventDefault) {
				evt.preventDefault();
			}

			// Navigate back to the amount screen.
			app.router.navigate('pay', { trigger: true });
		},

		back: function(evt) {

			if (evt && evt.preventDefault) {
				evt.preventDefault();
			}

			var amount = this.options.amount.toString();

			// Navigate back to the payment method screen.
			app.router.navigate('pay/' + encodeURIComponent(amount), { trigger: true });
		},

		reRenderQrCode: function() {

			if (this.paymentRequestUri) {
				this.renderQrCode(this.paymentRequestUri);
			}
		},

		onResize: function() {

			this.reRenderQrCode();
		},

		onClose: function() {

			clearTimeout(this._createPaymentRequestTimeout);
			this.stopListeningForPayment();
		},

		onBackButton: function() {

			this.back();
		}

	});

})();
