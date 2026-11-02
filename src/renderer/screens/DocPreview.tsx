import { useState } from "react";
import type { PreviewBlock } from "../../shared/preview";
import type { SheetItem } from "../../shared/state";

const STATUS: Record<SheetItem["status"], string> = {
	source: "no dokumenta",
	manual: "ievadīts ar roku",
	missing: "trūkst",
	na: "neattiecas",
};

/** A field that still needs a value: empty, or filled by the agent with a note about what to add. */
export const isOpenItem = (i: SheetItem) => i.kind !== "delete" && (i.status === "missing" || /^Papildin/.test(i.note ?? ""));

type Save = (slotId: string, value: string | null) => void;

/** One field of the document: shows its value (or the template's instruction and a red marker), and edits in place. */
function Slot({ item, onSave, inline }: { item: SheetItem; onSave: Save; inline: boolean }) {
	const [editing, setEditing] = useState(false);
	const [v, setV] = useState(item.value);
	const open = () => {
		setV(item.value);
		setEditing(true);
	};
	const done = (value: string | null) => {
		onSave(item.slotId, value);
		setEditing(false);
	};

	if (editing) {
		return (
			<div className="doc-edit" id={`slot-${item.slotId}`}>
				{inline ? (
					<input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? done(v) : e.key === "Escape" && setEditing(false))} />
				) : (
					<textarea autoFocus rows={7} value={v} onChange={(e) => setV(e.target.value)} />
				)}
				<div className="row">
					<button className="primary" onClick={() => done(v)}>Saglabāt</button>
					<button onClick={() => setEditing(false)}>Atcelt</button>
					{item.status !== "missing" && <button onClick={() => done(null)}>Atstāt tukšu</button>}
				</div>
			</div>
		);
	}

	const label = STATUS[item.status];
	return (
		<div className={`doc-slot ${inline ? "inline" : ""} s-${item.status} ${isOpenItem(item) ? "open" : ""}`} id={`slot-${item.slotId}`}>
			{item.value ? (
				<div className="doc-value">{item.value}</div>
			) : (
				<>
					{!inline && item.instruction && <div className="doc-instruction">{item.instruction}</div>}
					<span className="missing">[aizpildīt]</span>
				</>
			)}
			{item.cites.length > 0 && (
				<details className="doc-cite">
					<summary>avots: {item.cites[0].file}</summary>
					{item.cites.map((c, i) => <div key={i} className="quote-pop">“{c.quote}”</div>)}
				</details>
			)}
			{item.note && <div className="hint">{item.note}</div>}
			<div className="doc-meta">
				<span className="hint">{label}</span>
				<button className="link" onClick={open}>labot</button>
			</div>
		</div>
	);
}

/** The BIP (or any Word template) as a document, with every field in its place. */
export function DocPreview({ blocks, items, onSave }: { blocks: PreviewBlock[]; items: Map<string, SheetItem>; onSave: Save }) {
	return (
		<div className="doc">
			{blocks.map((b, n) => {
				if (b.kind === "text") return b.level > 0 ? <div key={n} className={`doc-h doc-h${Math.min(b.level, 4)}`}>{b.text}</div> : <p key={n} className="doc-p">{b.text}</p>;
				if (b.kind === "slot") {
					const it = items.get(b.slotId);
					return it ? <Slot key={b.slotId} item={it} onSave={onSave} inline={false} /> : null;
				}
				return (
					<table key={n} className="doc-table">
						<tbody>
							{b.rows.map((row, r) => (
								<tr key={r}>
									{row.map((cell, c) => {
										const it = cell.slotId ? items.get(cell.slotId) : undefined;
										return <td key={c}>{it ? <Slot item={it} onSave={onSave} inline /> : cell.text}</td>;
									})}
								</tr>
							))}
						</tbody>
					</table>
				);
			})}
		</div>
	);
}
