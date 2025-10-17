// src/lib/turso-api.ts
/**
 * Turso Platform API Client
 *
 * Wrapper for Turso Platform API to programmatically create and manage databases.
 * Used for tenant provisioning in multi-tenant architecture.
 *
 * @see https://docs.turso.tech/api-reference/introduction
 */

/**
 * Turso Platform API configuration
 */
export interface TursoApiConfig {
  organizationSlug: string;
  apiToken: string;
  baseUrl?: string;
}

/**
 * Database creation request parameters
 */
export interface CreateDatabaseRequest {
  name: string;
  group: string;
  seed?: {
    type: 'database';
    name: string;
  };
  size_limit?: string; // e.g., "1gb", "256mb"
}

/**
 * Database creation response
 */
export interface CreateDatabaseResponse {
  database: {
    DbId: string;
    Hostname: string;
    Name: string;
  };
}

/**
 * API token creation response
 */
export interface CreateTokenResponse {
  name: string;
  id: string;
  token: string;
}

/**
 * Turso Platform API Client
 */
export class TursoApiClient {
  private config: TursoApiConfig;
  private baseUrl: string;

  constructor(config: TursoApiConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.turso.tech/v1';
  }

  /**
   * Create a new Turso database
   *
   * @param params - Database creation parameters
   * @returns Database creation response with DbId, Hostname, Name
   * @throws Error if database creation fails
   */
  async createDatabase(params: CreateDatabaseRequest): Promise<CreateDatabaseResponse> {
    const url = `${this.baseUrl}/organizations/${this.config.organizationSlug}/databases`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error: any = await response.json().catch(() => ({}));
        throw new Error(
          `Turso API error (${response.status}): ${error.message || response.statusText}`
        );
      }

      const data = await response.json() as CreateDatabaseResponse;
      return data;
    } catch (error) {
      console.error('[TursoAPI] Database creation failed:', error);
      throw new Error(
        `Failed to create database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create a database authentication token
   *
   * @param databaseName - Database name to create token for
   * @param tokenName - Name for the API token
   * @returns Token creation response with token string
   * @throws Error if token creation fails
   */
  async createDatabaseToken(
    databaseName: string,
    tokenName: string
  ): Promise<CreateTokenResponse> {
    const url = `${this.baseUrl}/organizations/${this.config.organizationSlug}/databases/${databaseName}/auth/tokens`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Token expiration: "never" or specific duration
          // We use "never" for tenant databases
        }),
      });

      if (!response.ok) {
        const error: any = await response.json().catch(() => ({}));
        throw new Error(
          `Turso API error (${response.status}): ${error.message || response.statusText}`
        );
      }

      // Response format: { jwt: "token_string" }
      const data: any = await response.json();

      return {
        name: tokenName,
        id: databaseName,
        token: data.jwt,
      };
    } catch (error) {
      console.error('[TursoAPI] Token creation failed:', error);
      throw new Error(
        `Failed to create database token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete a Turso database
   *
   * @param databaseName - Database name to delete
   * @throws Error if database deletion fails
   */
  async deleteDatabase(databaseName: string): Promise<void> {
    const url = `${this.baseUrl}/organizations/${this.config.organizationSlug}/databases/${databaseName}`;

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
        },
      });

      if (!response.ok) {
        const error: any = await response.json().catch(() => ({}));
        throw new Error(
          `Turso API error (${response.status}): ${error.message || response.statusText}`
        );
      }
    } catch (error) {
      console.error('[TursoAPI] Database deletion failed:', error);
      throw new Error(
        `Failed to delete database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

/**
 * Create Turso API client from environment variables
 *
 * Required environment variables:
 * - TURSO_ORGANIZATION: Turso organization slug
 * - TURSO_API_TOKEN: Turso Platform API token
 *
 * @returns Configured TursoApiClient
 * @throws Error if required environment variables are missing
 */
export function createTursoApiClient(): TursoApiClient {
  const organizationSlug = process.env.TURSO_ORGANIZATION;
  const apiToken = process.env.TURSO_API_TOKEN;

  if (!organizationSlug) {
    throw new Error('TURSO_ORGANIZATION environment variable is required');
  }

  if (!apiToken) {
    throw new Error('TURSO_API_TOKEN environment variable is required');
  }

  return new TursoApiClient({
    organizationSlug,
    apiToken,
  });
}
