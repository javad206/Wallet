'use strict';

angular.module('copayApp.controllers').controller('shapeshiftController', function($scope, $interval, profileService, walletService, popupService) {

  var walletsBtc = [];
  var walletsBch = [];

  function generateAddress(wallet, cb) {
    if (!wallet) return;
    walletService.getAddress(wallet, false, function(err, addr) {
      if (err) {
        popupService.showAlert(err);
      }
      return cb(addr);
    });
  }

  function showToWallets() {
    $scope.toWallets = $scope.fromWallet.coin == 'btc' ? walletsBch : walletsBtc;
    $scope.onToWalletSelect($scope.toWallets[0]);
    $scope.singleToWallet = $scope.toWallets.length == 1;
  }

  $scope.onFromWalletSelect = function(wallet) {
    $scope.fromWallet = wallet;
    showToWallets();
    generateAddress(wallet, function(addr) {
      $scope.fromWalletAddress = addr;
    });
  };

  $scope.onToWalletSelect = function(wallet) {
    $scope.toWallet = wallet;
    generateAddress(wallet, function(addr) {
      $scope.toWalletAddress = addr;
    });
  }

  $scope.$on("$ionicView.beforeEnter", function(event, data) {
    walletsBtc = profileService.getWallets({coin: 'btc'});
    walletsBch = profileService.getWallets({coin: 'bch'});
    $scope.fromWallets = walletsBtc.concat(walletsBch);
    $scope.toWallets = walletsBch;
    if ($scope.fromWallets.length == 0 || $scope.toWallets.length == 0) return;
    $scope.onFromWalletSelect($scope.fromWallets[0]);
    $scope.onToWalletSelect($scope.toWallets[0]);
    $scope.singleFromWallet = $scope.fromWallets.length == 1;
    $scope.singleToWallet = $scope.toWallets.length == 1;
    $scope.toWalletSelectorTitle = 'To';
    $scope.showFromWallets = false;
    $scope.showToWallets = false;
  });

  $scope.showFromWalletSelector = function() {
    $scope.showFromWallets = true;
  }

  $scope.showToWalletSelector = function() {
    $scope.showToWallets = true;
  }

  /*var setAddress = function(newAddr) {
    $scope.addr = null;
    if (!$scope.wallet || $scope.generatingAddress || !$scope.wallet.isComplete()) return;
    $scope.generatingAddress = true;
    walletService.getAddress($scope.wallet, newAddr, function(err, addr) {
      $scope.generatingAddress = false;

      if (err) {
        //Error is already formated
        popupService.showAlert(err);
      }

      $scope.addr = addr;
      $timeout(function() {
        $scope.$apply();
      }, 10);
    });
  };*/
});