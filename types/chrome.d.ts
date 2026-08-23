/**
 * Chrome Extension MV3 API Ambient Declarations
 */

declare namespace chrome.runtime {
  export const id: string;
  export interface MessageSender {
    tab?: chrome.tabs.Tab;
    frameId?: number;
    id?: string;
    url?: string;
    tlsChannelId?: string;
  }
  export interface ExtensionMessageEvent {
    addListener(callback: (message: any, sender: MessageSender, sendResponse: (response?: any) => void) => boolean | void | Promise<any>): void;
    removeListener(callback: Function): void;
    hasListener(callback: Function): boolean;
  }
  export const onMessage: ExtensionMessageEvent;
  export const onInstalled: {
    addListener(callback: (details: { reason: string; previousVersion?: string }) => void): void;
  };
  export function sendMessage(message: any): Promise<any>;
  export function sendMessage(extensionId: string, message: any): Promise<any>;
}

declare namespace chrome.tabs {
  export interface Tab {
    id?: number;
    index: number;
    windowId: number;
    highlighted: boolean;
    active: boolean;
    pinned: boolean;
    url?: string;
    title?: string;
    favIconUrl?: string;
    status?: string;
    incognito: boolean;
    width?: number;
    height?: number;
    sessionId?: string;
  }
  export function query(queryInfo: { active?: boolean; currentWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
  export function get(tabId: number): Promise<Tab>;
  export function sendMessage(tabId: number, message: any, options?: any): Promise<any>;
  export const onRemoved: {
    addListener(callback: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
  };
  export const onActivated: {
    addListener(callback: (activeInfo: { tabId: number; windowId: number }) => void): void;
  };
  export const onUpdated: {
    addListener(callback: (tabId: number, changeInfo: { url?: string; status?: string }, tab: Tab) => void): void;
  };
}

declare namespace chrome.webRequest {
  export interface RequestDetails {
    requestId: string;
    url: string;
    method: string;
    frameId: number;
    parentFrameId: number;
    tabId: number;
    type: string;
    timeStamp: number;
  }
  export interface WebRequestBodyEvent {
    addListener(callback: (details: RequestDetails) => void, filter: { urls: string[] }): void;
  }
  export const onBeforeRequest: WebRequestBodyEvent;
}

declare namespace chrome.sidePanel {
  export interface PanelOptions {
    tabId?: number;
    path?: string;
    enabled?: boolean;
  }
  export interface PanelBehavior {
    openPanelOnActionClick?: boolean;
  }
  export function setOptions(options: PanelOptions): Promise<void>;
  export function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
  export function open(options: { tabId?: number; windowId?: number }): Promise<void>;
}

declare namespace chrome.scripting {
  export interface ScriptInjection {
    target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
    files?: string[];
    world?: 'ISOLATED' | 'MAIN';
  }
  export function executeScript(injection: ScriptInjection): Promise<any[]>;
}

declare namespace chrome.storage {
  export interface StorageArea {
    get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
    set(items: Record<string, any>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    clear(): Promise<void>;
  }
  export const sync: StorageArea;
  export const local: StorageArea;
  export const session: StorageArea;
}
