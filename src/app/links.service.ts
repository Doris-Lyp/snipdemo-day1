import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export interface Link {
  code: string;
  url: string;
  shortUrl: string;
  hits: number;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class LinksService {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<Link[]>('/api/links');
  }

  create(url: string) {
    return this.http.post<Link>('/api/links', { url });
  }
}
