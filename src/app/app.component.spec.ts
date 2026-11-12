import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { Link } from './links.service';

describe('Snip form and links table', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;
  let http: HttpTestingController;
  const link: Link = {
    code: 'Ab123x', url: 'https://example.com/story',
    shortUrl: 'http://localhost:3000/Ab123x', hits: 0,
    createdAt: '2026-11-12T00:00:00.000Z'
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent || '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function finishLoad(links: Link[] = []) {
    http.expectOne('/api/links').flush(links);
    fixture.detectChanges();
  }

  it('shows loading and empty states, then rejects missing and non-HTTP URLs without posting', () => {
    expect(text()).toContain('Loading links...');
    finishLoad();
    expect(text()).toContain('No links yet.');
    for (const value of ['', 'not a url', 'ftp://example.com', 'javascript:alert(1)']) {
      app.form.controls.url.setValue(value);
      app.submit();
      expect(app.form.invalid).toBeTrue();
    }
    fixture.detectChanges();
    expect(text()).toContain('Enter a valid HTTP or HTTPS URL.');
    http.expectNone((request) => request.method === 'POST');
  });

  it('trims HTTP(S) input, prevents duplicate submissions, and refreshes the rendered table', () => {
    finishLoad();
    app.form.controls.url.setValue(`  ${link.url}  `);
    app.submit();
    app.submit();
    expect(app.pending()).toBeTrue();
    expect(app.form.controls.url.disabled).toBeTrue();
    const request = http.expectOne('/api/links');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ url: link.url });
    request.flush(link, { status: 201, statusText: 'Created' });
    http.expectOne('/api/links').flush([link]);
    fixture.detectChanges();
    expect(app.pending()).toBeFalse();
    expect(app.form.controls.url.enabled).toBeTrue();
    expect(app.form.controls.url.value).toBe('');
    expect(text()).toContain('Your short link is ready');
    expect(text()).toContain(link.url);
    const shortAnchor = (fixture.nativeElement as HTMLElement).querySelector('tbody a');
    expect(shortAnchor?.getAttribute('href')).toBe(link.shortUrl);
    expect(shortAnchor?.textContent).toBe(link.code);
  });

  it('shows server field errors and permits retry without losing the URL', () => {
    finishLoad();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush({ error: 'URL was rejected.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(text()).toContain('URL was rejected.');
    expect(app.form.controls.url.value).toBe(link.url);
    expect(app.pending()).toBeFalse();
    app.form.controls.url.setValue('http://example.com');
    expect(app.submitError()).toBe('');
    app.submit();
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain('Cannot reach the server');
    expect(app.pending()).toBeFalse();
  });

  it('replaces an older list request when creation finishes during initial loading', () => {
    const initialRequest = http.expectOne('/api/links');
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush(link, { status: 201, statusText: 'Created' });
    expect(initialRequest.cancelled).toBeTrue();
    http.expectOne('/api/links').flush([link]);
    expect(app.links()).toEqual([link]);
    expect(app.loading()).toBeFalse();
  });

  it('keeps the successful link visible if the subsequent refresh fails', () => {
    finishLoad();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush(link, { status: 201, statusText: 'Created' });
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain('Your short link is ready');
    expect(text()).toContain('Cannot reach the server');
    expect(app.links()).toEqual([link]);
  });

  it('reports list failures and recovers on refresh with updated hits', () => {
    http.expectOne('/api/links').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(text()).toContain('Request failed (503)');
    expect(text()).not.toContain('No links yet.');
    app.refresh();
    http.expectOne('/api/links').flush([{ ...link, hits: 3 }]);
    fixture.detectChanges();
    expect(app.listError()).toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelector('tbody tr')?.textContent).toContain('3');
  });
});
