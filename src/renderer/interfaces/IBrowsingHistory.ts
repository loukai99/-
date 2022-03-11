export type HistoryDisplayItem = {
  url: string,
  title: string,
  channel: string,
  openTime: number,
  style: number,
  icon: string,
}

export type IBrowsingHistoryMenuInfo = {
  url: string,
  title: string,
  channel: string,
  iconPath: string,
}

export interface IBrowsingHistory {
  getHistorys(): Promise<HistoryDisplayItem[]>,
  getMenuDisplayInfo(): Promise<IBrowsingHistoryMenuInfo[]>,
  saveHistoryItem(url: string, title: string, channel: string): Promise<IDBValidKey>,
  cleanChannelRecords(channel: string): Promise<void>,
}
