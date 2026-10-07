export interface KeyDocTableColumn {
  name: string;
  dataType: string;
  jsonType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
}

export interface KeyDocEndpoint {
  method: string;
  path: string;
  description: string;
}

export interface KeyDocTable {
  table: string;
  actions: string[];
  rowScope?: { column: string } | null;
  endpoints: KeyDocEndpoint[];
  columns: {
    readable: KeyDocTableColumn[];
    writable: KeyDocTableColumn[];
  };
}

export interface KeyDocRelationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: string;
  description?: string;
}

export interface KeyDocProxyService {
  id: string;
  name: string;
  baseUrl: string;
  description: string;
  endpoints: KeyDocEndpoint[];
  policy?: any;
}

export interface KeyDocProfile {
  keyId: string;
  clientName: string;
  role: string;
  rateLimitRpm: number;
  allowedTablesCount: number;
  tables: KeyDocTable[];
  relationships: KeyDocRelationship[];
  proxies: Record<string, any>;
  proxyServices: KeyDocProxyService[];
  aiRemarks: {
    mandatoryDirective: string;
    memoryInstruction: string;
    gatewayRole: string;
  };
  keyToUse: string;
  host: string;
  rawSecret?: string;
  aiPrompt: string;
}
