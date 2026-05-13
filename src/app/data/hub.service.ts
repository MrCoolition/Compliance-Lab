import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { HubActionResponse, HubResponse, OpenStockChange, SaveChangesResponse, UndoChangesResponse } from '../models/hub';

@Injectable({ providedIn: 'root' })
export class HubService {
  private readonly http = inject(HttpClient);

  private apiError(error: unknown): Error {
    const maybe = error as { error?: { error?: string; details?: unknown }; message?: string };
    const message = maybe.error?.error || maybe.message || 'Request failed.';
    return new Error(message);
  }

  async getHubRows(args: {
    hubKey: string;
    page: number;
    pageSize: number;
    search?: string;
    runDate?: string;
    filters?: Record<string, string[]>;
  }): Promise<HubResponse> {
    let params = new HttpParams()
      .set('page', String(args.page))
      .set('pageSize', String(args.pageSize));

    if (args.search) {
      params = params.set('search', args.search);
    }
    if (args.runDate) {
      params = params.set('runDate', args.runDate);
    }
    if (args.filters && Object.keys(args.filters).length > 0) {
      params = params.set('filters', JSON.stringify(args.filters));
    }

    try {
      return await firstValueFrom(this.http.get<HubResponse>(`/api/hubs/${args.hubKey}`, { params }));
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async syncHub(hubKey: string, runDate?: string): Promise<unknown> {
    let params = new HttpParams();
    if (runDate) {
      params = params.set('runDate', runDate);
    }
    try {
      return await firstValueFrom(this.http.post(`/api/sync/${hubKey}`, {}, { params }));
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async saveOpenStockChanges(runDate: string, changes: OpenStockChange[], userName: string): Promise<SaveChangesResponse> {
    try {
      return await firstValueFrom(
        this.http.post<SaveChangesResponse>('/api/open-stock/changes', {
          runDate,
          userName,
          changes,
        }),
      );
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async undoOpenStockChange(runDate: string, userName: string): Promise<UndoChangesResponse> {
    try {
      return await firstValueFrom(
        this.http.post<UndoChangesResponse>('/api/open-stock/undo', {
          runDate,
          userName,
        }),
      );
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async getRecentOpenStockDates(): Promise<string[]> {
    try {
      const response = await firstValueFrom(this.http.get<{ dates: string[] }>('/api/open-stock/dates'));
      return response.dates;
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async runHubAction(hubKey: string, action: string, payload: Record<string, unknown>): Promise<HubActionResponse> {
    try {
      return await firstValueFrom(
        this.http.post<HubActionResponse>(`/api/hub-actions/${hubKey}`, {
          action,
          payload,
        }),
      );
    } catch (error) {
      throw this.apiError(error);
    }
  }

  async submitFeedback(appName: string, rating: number, feedbackText: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/feedback', {
          appName,
          rating,
          feedbackText,
          context: { source: 'angular_hub_feedback' },
        }),
      );
    } catch (error) {
      throw this.apiError(error);
    }
  }
}
