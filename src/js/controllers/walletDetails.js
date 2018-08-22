'use strict';

angular.module('copayApp.controllers').controller('walletDetailsController', function($scope, $rootScope, $interval, $timeout, $filter, $log, $ionicModal, $ionicPopover, $state, $stateParams, $ionicHistory, profileService, lodash, configService, platformInfo, walletService, txpModalService, externalLinkService, popupService, addressbookService, sendFlowService, storageService, $ionicScrollDelegate, $window, bwcError, gettextCatalog, timeService, feeService, appConfigService, rateService, walletHistoryService) {
  // Desktop can display 13 rows of transactions, bump it up to a nice round 15.
  var DISPLAY_PAGE_SIZE = 15;
  var currentTxHistoryDisplayPage = 0;
  var completeTxHistory = []
  var listeners = [];

  // For gradual migration for doing it properly
  $scope.vm = {
    allowInfiniteScroll: false,
    gettingCachedHistory: true,
    gettingInitialHistory: true,
    updatingTxHistory: false,
    fetchedAllTxHistory: false,
    //updateTxHistoryError: false
    updateTxHistoryFailed: false
  };

  // Need flag for when to allow infinite scroll at bottom
  // - ie not when loading initial data and there is no more cached data

  $scope.amountIsCollapsible = false;
  $scope.color = '#888888';
  
  $scope.filteredTxHistory = [];
  $scope.isCordova = platformInfo.isCordova;
  $scope.isAndroid = platformInfo.isAndroid;
  $scope.isIOS = platformInfo.isIOS;
  $scope.isSearching = false;
  $scope.openTxpModal = txpModalService.open;
  $scope.requiresMultipleSignatures = false;
  $scope.showBalanceButton = false;
  $scope.status = null;
  // Displaying 50 transactions when entering the screen takes a while, so only display a subset
  // of everything we have, not the complete history.
  $scope.txHistory = [];                 // This is what is displayed
  $scope.txHistorySearchResults = [];
  $scope.txps = [];
  $scope.updatingStatus = false;
  $scope.updateStatusError = null;
  $scope.updatingTxHistoryProgress = 0;
  $scope.wallet = null;
  $scope.walletId = '';
  $scope.walletNotRegistered = false;

    
    

  var channel = "ga";
  if (platformInfo.isCordova) {
    channel = "firebase";
  }
  var log = new window.BitAnalytics.LogEvent("wallet_details_open", [], [channel]);
  window.BitAnalytics.LogEventHandlers.postEvent(log);

  $scope.amountIsCollapsible = !$scope.isAndroid;

  $scope.openExternalLink = function(url, target) {
    externalLinkService.open(url, target);
  };

  var setPendingTxps = function(txps) {

    /* Uncomment to test multiple outputs */

    // var txp = {
    //   message: 'test multi-output',
    //   fee: 1000,
    //   createdOn: new Date() / 1000,
    //   outputs: [],
    //   wallet: $scope.wallet
    // };
    //
    // function addOutput(n) {
    //   txp.outputs.push({
    //     amount: 600,
    //     toAddress: '2N8bhEwbKtMvR2jqMRcTCQqzHP6zXGToXcK',
    //     message: 'output #' + (Number(n) + 1)
    //   });
    // };
    // lodash.times(15, addOutput);
    // txps.push(txp);

    if (!txps) {
      $scope.txps = [];
      return;
    }
    $scope.txps = lodash.sortBy(txps, 'createdOn').reverse();
  };

  var analyzeUtxosDone;

  var analyzeUtxos = function() {
    if (analyzeUtxosDone) return;

    feeService.getFeeLevels($scope.wallet.coin, function(err, levels) {
      if (err) return;
      walletService.getLowUtxos($scope.wallet, levels, function(err, resp) {
        if (err || !resp) return;
        analyzeUtxosDone = true;
        $scope.lowUtxosWarning = resp.warning;
      });
    });
  };

  var updateStatus = function(force) {
    $scope.updatingStatus = true;
    $scope.updateStatusError = null;
    $scope.walletNotRegistered = false;
    $scope.vm.fetchedAllTxHistory = false;

    walletService.getStatus($scope.wallet, {
      force: !!force,
    }, function(err, status) {
      $scope.updatingStatus = false;
      if (err) {
        if (err === 'WALLET_NOT_REGISTERED') {
          $scope.walletNotRegistered = true;
        } else {
          $scope.updateStatusError = bwcError.msg(err, gettextCatalog.getString('Could not update wallet'));
        }
        $scope.status = null;
      } else {
        setPendingTxps(status.pendingTxps);
        if (!$scope.status || status.balance.totalAmount != $scope.status.balance.totalAmount) {
            $scope.status = status;
        }
      }

      $timeout(function() {
        $scope.$apply();
      });

      analyzeUtxos();

    });
  };

  $scope.openSearchModal = function() {
    $scope.color = $scope.wallet.color;
    $scope.isSearching = true;
    $scope.txHistorySearchResults = [];
    $scope.filteredTxHistory = [];

    $ionicModal.fromTemplateUrl('views/modals/search.html', {
      scope: $scope,
      focusFirstInput: true
    }).then(function(modal) {
      $scope.searchModal = modal;
      $scope.searchModal.show();
    });

    $scope.close = function() {
      $scope.isSearching = false;
      $scope.searchModal.hide();
    };

    $scope.openTx = function(tx) {
      $ionicHistory.nextViewOptions({
        disableAnimate: true
      });
      $scope.close();
      $scope.openTxModal(tx);
    };
  };

  $scope.openTxModal = function(btx) {
    $scope.btx = lodash.cloneDeep(btx);
    $scope.walletId = $scope.wallet.id;
    $state.transitionTo('tabs.wallet.tx-details', {
      txid: $scope.btx.txid,
      walletId: $scope.walletId
    });
  };

  $scope.openBalanceModal = function() {
    $ionicModal.fromTemplateUrl('views/modals/wallet-balance.html', {
      scope: $scope
    }).then(function(modal) {
      $scope.walletBalanceModal = modal;
      $scope.walletBalanceModal.show();
    });

    $scope.close = function() {
      $scope.walletBalanceModal.hide();
    };
  };

  $scope.recreate = function() {
    walletService.recreate($scope.wallet, function(err) {
      if (err) return;
      $timeout(function() {
        walletService.startScan($scope.wallet, function() {
          $scope.updateAll(true, true);
          $scope.$apply();
        });
      });
    });
  };

  function applyCurrencyAliases(txHistory) {
    var defaults = configService.getDefaults();
    var configCache = configService.getSync();

    lodash.each(txHistory, function onTx(tx) {
      tx.amountUnitStr = $scope.wallet.coin == 'btc'
                        ? (configCache.bitcoinAlias || defaults.bitcoinAlias)
                        : (configCache.bitcoinCashAlias || defaults.bitcoinCashAlias);

      tx.amountUnitStr = tx.amountUnitStr.toUpperCase();
    });
  }

  function formatTxHistoryForDisplay(txHistory) {
    applyCurrencyAliases(txHistory);

    var config = configService.getSync();
    var fiatCode = config.wallet.settings.alternativeIsoCode;
    lodash.each(txHistory, function(t) {
      var r = rateService.toFiat(t.amount, fiatCode, $scope.wallet.coin);
      t.alternativeAmountStr = r.toFixed(2) + ' ' + fiatCode;
    });
  }


  function updateTxHistoryFromCachedData() {
    walletHistoryService.getCachedTxHistory($scope.wallet.id, function onGetCachedTxHistory(err, txHistory){
      $scope.vm.gettingCachedHistory = false;
      if (err) {
        // Don't display an error because we are also requesting the history.
        $log.error('Error getting cached tx history.', err);
        return;
      }

      if (!txHistory) {
        $log.debug('No cached tx history.');
        return;
      }

      console.log('pagination Got cached txs, count: ', txHistory.length);
      formatTxHistoryForDisplay(txHistory);

      completeTxHistory = txHistory;
      showHistory(false);
      console.log('pagination Showing tx history items:', $scope.txHistory.length);
      $scope.$apply();
      console.log('pagination displayed cached history.');
    });
  }

  function fetchAndShowTxHistory(getLatest, flushCacheOnNew) {
    console.log('pagination fetchAndShowTxHistory() getLatest:', getLatest, ', flushCacheOnNew:', flushCacheOnNew);
    $scope.vm.updatingTxHistory = true;

    walletHistoryService.updateLocalTxHistoryByPage($scope.wallet, getLatest, flushCacheOnNew, function onUpdateLocalTxHistoryByPage(err, txHistory, fetchedAllTransactions) {
      console.log('pagination returned');
      $scope.vm.gettingInitialHistory = false;
      $scope.vm.updatingTxHistory = false;
      $scope.$broadcast('scroll.infiniteScrollComplete');

      if (err) {
        console.error('pagination Failed to get history.', err);
        $scope.vm.updateTxHistoryFailed = true;
        return;
      }

      if (fetchedAllTransactions) {
        console.log("All transactions seem to be fetched..");
        $scope.vm.fetchedAllTxHistory = true;
      }

      console.log('pagination txs returned in history: ' + txHistory.length);
      formatTxHistoryForDisplay(txHistory);

      completeTxHistory = txHistory;
      showHistory(true);
      $scope.$apply();
    });
  }

  
  function showHistory(showAll) {
    if (completeTxHistory) {
      $scope.txHistory = showAll ? completeTxHistory : completeTxHistory.slice(0, (currentTxHistoryDisplayPage + 1) * DISPLAY_PAGE_SIZE);
      $scope.vm.allowInfiniteScroll = !$scope.vm.fetchedAllTxHistory;//(completeTxHistory.length > $scope.txHistory.length || !$scope.vm.gettingInitialHistory) || (!$scope.vm.gettingInitialHistory && !$scope.vm.fetchedAllTxHistory);
      console.log('pagination Showing txs: ', $scope.txHistory.length);
    } else {
      $scope.vm.allowInfiniteScroll = false;
    }
  }
  

  $scope.getDate = function(txCreated) {
    var date = new Date(txCreated * 1000);
    return date;
  };

  $scope.isFirstInGroup = function(index) {
    if (index === 0) {
      return true;
    }
    var curTx = $scope.txHistory[index];
    var prevTx = $scope.txHistory[index - 1];
    return !$scope.createdDuringSameMonth(curTx, prevTx);
  };

  $scope.isLastInGroup = function(index) {
    if (index === $scope.txHistory.length - 1) {
      return true;
    }
    return $scope.isFirstInGroup(index + 1);
  };

  $scope.createdDuringSameMonth = function(curTx, prevTx) {
    return timeService.withinSameMonth(curTx.time * 1000, prevTx.time * 1000);
  };

  $scope.createdWithinPastDay = function(time) {
    return timeService.withinPastDay(time);
  };

  $scope.isDateInCurrentMonth = function(date) {
    return timeService.isDateInCurrentMonth(date);
  };

  $scope.isUnconfirmed = function(tx) {
    return !tx.confirmations || tx.confirmations === 0;
  };

  // on-infinite="showMore()"
  $scope.showMore = function() {
    console.log('pagination showMore()');
    if ($scope.vm.updatingTxHistory) {
      return;
    }

    // Check if we have more than we are displaying
    if (completeTxHistory.length > $scope.txHistory.length) {
      currentTxHistoryDisplayPage++;
      showHistory();
      $scope.$broadcast('scroll.infiniteScrollComplete');
      return;
    }

    fetchAndShowTxHistory(false, false);
  };

  // on-refresh="onRefresh()"
  $scope.onRefresh = function() {
    $timeout(function() {
      $scope.$broadcast('scroll.refreshComplete');
    }, 300);
    $scope.updateAll(true, false);
  };

  $scope.updateAll = function(forceStatusUpdate, flushTxCacheOnNew)  {
    console.log('pagination updateAll()');
    updateStatus(forceStatusUpdate);
    //updateTxHistory(cb);
    fetchAndShowTxHistory(true, flushTxCacheOnNew);
  };

  $scope.hideToggle = function() {
    profileService.toggleHideBalanceFlag($scope.wallet.credentials.walletId, function(err) {
      if (err) $log.error(err);
    });
  };

  var prevPos;

  function getScrollPosition() {
    var scrollPosition = $ionicScrollDelegate.getScrollPosition();
    if (!scrollPosition) {
      $window.requestAnimationFrame(function() {
        getScrollPosition();
      });
      return;
    }
    var pos = scrollPosition.top;
    if (pos === prevPos) {
      $window.requestAnimationFrame(function() {
        getScrollPosition();
      });
      return;
    }
    prevPos = pos;
    refreshAmountSection(pos);
  };

  function refreshAmountSection(scrollPos) {
    var AMOUNT_HEIGHT_BASE = 210;
    $scope.showBalanceButton = false;
    if ($scope.status) {
      $scope.showBalanceButton = ($scope.status.totalBalanceSat != $scope.status.spendableAmount);
      if ($scope.showBalanceButton) {
        AMOUNT_HEIGHT_BASE = 270;
      }
    }
    if (!$scope.amountIsCollapsible) {
      var t = ($scope.showBalanceButton ? 15 : 45);
      $scope.amountScale = 'translateY(' + t + 'px)';
      return;
    }

    scrollPos = scrollPos || 0;
    var amountHeight = AMOUNT_HEIGHT_BASE - scrollPos;
    if (amountHeight < 80) {
      amountHeight = 80;
    }
    var contentMargin = amountHeight;
    if (contentMargin > AMOUNT_HEIGHT_BASE) {
      contentMargin = AMOUNT_HEIGHT_BASE;
    }

    var amountScale = (amountHeight / AMOUNT_HEIGHT_BASE);
    if (amountScale < 0.5) {
      amountScale = 0.5;
    }
    if (amountScale > 1.1) {
      amountScale = 1.1;
    }

    var s = amountScale;

    // Make space for the balance button when it needs to display.
    var TOP_NO_BALANCE_BUTTON = 115;
    var TOP_BALANCE_BUTTON = 30;
    var top = TOP_NO_BALANCE_BUTTON;
    if ($scope.showBalanceButton) {
      top = TOP_BALANCE_BUTTON;
    }

    var amountTop = ((amountScale - 0.80) / 0.80) * top;
    if (amountTop < -2) {
      amountTop = -2;
    }
    if (amountTop > top) {
      amountTop = top;
    }

    var t = amountTop;

    $scope.altAmountOpacity = (amountHeight - 100) / 80;
    $scope.buttonsOpacity = (amountHeight - 140) / 70;
    $window.requestAnimationFrame(function() {
      $scope.amountHeight = amountHeight + 'px';
      $scope.contentMargin = contentMargin + 'px';
      $scope.amountScale = 'scale3d(' + s + ',' + s + ',' + s + ') translateY(' + t + 'px)';
      $scope.$digest();
      getScrollPosition();
    });
  }

  var scrollWatcherInitialized;

  $scope.$on("$ionicView.enter", function(event, data) {
    if ($scope.isCordova && $scope.isAndroid) setAndroidStatusBarColor();
    if (scrollWatcherInitialized || !$scope.amountIsCollapsible) {
      return;
    }
    scrollWatcherInitialized = true;
  });

  $scope.$on("$ionicView.beforeEnter", function(event, data) {
    sendFlowService.clear();

    configService.whenAvailable(function (config) {
      $scope.selectedPriceDisplay = config.wallet.settings.priceDisplay;

      $timeout(function () {
        $scope.$apply();
      });
    });

    $scope.walletId = data.stateParams.walletId;
    $scope.wallet = profileService.getWallet($scope.walletId);
    if (!$scope.wallet) return;
    $scope.requiresMultipleSignatures = $scope.wallet.credentials.m > 1;

    $scope.vm.gettingInitialHistory = true;

    addressbookService.list(function(err, ab) {
      if (err) $log.error(err);
      $scope.addressbook = ab || {};
    });

    listeners = [
      $rootScope.$on('bwsEvent', function(e, walletId) {
        if (walletId == $scope.wallet.id && e.type != 'NewAddress')
          $scope.updateAll(false, false);
      }),
      $rootScope.$on('Local/TxAction', function(e, walletId) {
        if (walletId == $scope.wallet.id)
          $scope.updateAll(false, false);
      }),
    ];
  });

  var refreshInterval;

  $scope.$on("$ionicView.afterEnter", function(event, data) {
    updateTxHistoryFromCachedData();
    $scope.updateAll(false, true);
    refreshAmountSection();
    refreshInterval = $interval($scope.onRefresh, 10 * 1000);
    //refreshInterval = $interval($scope.onRefresh, 120 * 1000); // For testing
  });

  $scope.$on("$ionicView.afterLeave", function(event, data) {
    $interval.cancel(refreshInterval);
    if ($window.StatusBar) {
      $window.StatusBar.backgroundColorByHexString('#000000');
    }
  });

  $scope.$on("$ionicView.leave", function(event, data) {
    lodash.each(listeners, function(x) {
      x();
    });
  });

  function setAndroidStatusBarColor() {
    var SUBTRACT_AMOUNT = 15;
    var walletColor;
    if (!$scope.wallet.color) walletColor = appConfigService.name == 'copay' ? '#019477' : '#4a90e2';
    else walletColor = $scope.wallet.color;
    var rgb = hexToRgb(walletColor);
    var keys = Object.keys(rgb);
    keys.forEach(function(k) {
      if (rgb[k] - SUBTRACT_AMOUNT < 0) {
        rgb[k] = 0;
      } else {
        rgb[k] -= SUBTRACT_AMOUNT;
      }
    });
    var statusBarColorHexString = rgbToHex(rgb.r, rgb.g, rgb.b);
    if ($window.StatusBar)
      $window.StatusBar.backgroundColorByHexString(statusBarColorHexString);
  }

  function hexToRgb(hex) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
      return r + r + g + g + b + b;
    });

    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
  }

  function rgbToHex(r, g, b) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
  }

  $scope.goToSend = function() {
    sendFlowService.startSend({
      fromWalletId: $scope.wallet.id
    });
    
    // Go home first so that the Home tab works properly
    $state.go('tabs.home').then(function () {
      $ionicHistory.clearHistory();
      $state.go('tabs.send');
    });
    
  };
  $scope.goToReceive = function() {
    $state.go('tabs.home', {
      walletId: $scope.wallet.id
    }).then(function () {
      $ionicHistory.clearHistory();
      $state.go('tabs.receive', {
        walletId: $scope.wallet.id
      });
    });
  };
  
  $scope.goToBuy = function() {
    $state.go('tabs.home', {
      walletId: $scope.wallet.id
    }).then(function () {
      $ionicHistory.clearHistory();
      $state.go('tabs.buyandsell');
    });
  };
});
