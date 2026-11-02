// Pure live-acceptance predicate; no client connection or output side effects.
export function assessChatMarkerLive(results, colorMaps) {
  const confirmedChatSampleCount = results.reduce((sum, result) => sum + (result.chatRows ?? 0), 0);
  const chatPositiveCoverage = confirmedChatSampleCount > 0;
  const passed = results.length >= 2 && chatPositiveCoverage &&
    results.every(result => result.connected && result.ready && result.quotaMounted &&
      result.quotaVisibilityMatchesSetting && result.controlsInSharedCard &&
      result.cardAboveProfile && result.cardVisible && result.chatMarkersVisible &&
      result.chatMarkers === result.chatRows && result.chatMarkersMatchRows &&
      result.workRowsMarked === 0) &&
    colorMaps.length === results.length && colorMaps.every(value => value === colorMaps[0]);
  return { passed, confirmedChatSampleCount, chatPositiveCoverage };
}
