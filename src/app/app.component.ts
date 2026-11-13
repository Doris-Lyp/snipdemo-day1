import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { finalize, Subscription } from 'rxjs';
import { Link, LinksService } from './links.service';

const httpUrl: ValidatorFn = (control) => {
  if (!control.value) return null;
  try {
    const url = new URL(String(control.value).trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname
      ? null : { httpUrl: true };
  } catch {
    return { httpUrl: true };
  }
};

function errorMessage(error: HttpErrorResponse): string {
  if (error.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  if (typeof error.error?.error === 'string') return error.error.error;
  return `Request failed (${error.status}). Please try again.`;
}

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  private readonly api = inject(LinksService);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;
  readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required, httpUrl] })
  });
  readonly links = signal<Link[]>([]);
  readonly loading = signal(false);
  readonly pending = signal(false);
  readonly submitError = signal('');
  readonly listError = signal('');
  readonly result = signal<Link | null>(null);

  ngOnInit() {
    this.form.controls.url.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.submitError.set('');
      this.result.set(null);
    });
    this.refresh();
  }

  refresh() {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.listError.set('');
    this.listRequest = this.api.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (links) => this.links.set(links),
      error: (error: HttpErrorResponse) => this.listError.set(errorMessage(error))
    });
  }

  submit() {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.submitError.set('');
    this.result.set(null);
    this.pending.set(true);
    const url = this.form.controls.url.value.trim();
    this.form.controls.url.disable({ emitEvent: false });
    this.api.create(url).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.pending.set(false);
        this.form.controls.url.enable({ emitEvent: false });
      })
    ).subscribe({
      next: (link) => {
        this.result.set(link);
        this.form.controls.url.reset('', { emitEvent: false });
        this.links.update((links) => [...links, link]);
        this.refresh();
      },
      error: (error: HttpErrorResponse) => this.submitError.set(errorMessage(error))
    });
  }
}
