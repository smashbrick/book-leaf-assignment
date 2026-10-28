import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooks, useCreateTicket } from "../../api/hooks";
import { ErrorBox } from "../../components/ui";

export function NewTicketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const books = useBooks();
  const create = useCreateTicket();

  const [bookId, setBookId] = useState(params.get("bookId") ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { data } = await create.mutateAsync({ bookId: bookId || null, subject, description });
    navigate(`/tickets/${data.id}`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Get help</h1>
      </div>
      <form className="card form" onSubmit={submit}>
        <ErrorBox error={create.error} />
        <label>
          What is this about?
          <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">General / Account level</option>
            {books.data?.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} required minLength={5}
            placeholder="e.g. Royalty for last quarter not received" />
        </label>
        <label>
          Describe the issue
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} maxLength={5000} required minLength={20}
            placeholder="Include dates, amounts, order numbers or platform names so we can help faster." />
          <span className="muted small right">{description.length}/5000</span>
        </label>
        <label>
          Attachments <span className="muted">(optional)</span>
          <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          {files.length > 0 && (
            <span className="muted small">
              {files.map((f) => f.name).join(", ")}. File upload isn't enabled in this demo, so please describe what the files show.
            </span>
          )}
        </label>
        <div className="actions">
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? "Submitting…" : "Submit ticket"}
          </button>
        </div>
      </form>
    </>
  );
}
