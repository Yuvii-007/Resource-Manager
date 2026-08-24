import json
import os
import uuid
import webbrowser
from datetime import datetime

import customtkinter as ctk
from tkinter import messagebox

APP_TITLE = "Resource Manager"
DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "ResourceManager")
DATA_FILE = os.path.join(DATA_DIR, "resources.json")

COLORS = {
    "bg": ("#F0FDFA", "#0F172A"),
    "card": ("#FFFFFF", "#1E293B"),
    "text": ("#134E4A", "#F0FDFA"),
    "muted": ("#475569", "#94A3B8"),
    "border": ("#99F6E4", "#334155"),
    "primary": ("#0D9488", "#0D9488"),
    "primary_hover": ("#0F766E", "#14B8A6"),
    "accent": ("#EA580C", "#EA580C"),
    "accent_hover": ("#C2410C", "#F97316"),
    "danger": ("#DC2626", "#DC2626"),
    "danger_hover": ("#B91C1C", "#EF4444"),
}
FONT = "Segoe UI"


def load_resources():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_resources(resources):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(resources, f, ensure_ascii=False, indent=2)


def normalize_url(url):
    url = url.strip()
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


class ResourceDialog(ctk.CTkToplevel):
    def __init__(self, master, title, on_save, resource=None):
        super().__init__(master)
        self.on_save = on_save
        self.resource = resource or {}

        self.title(title)
        self.geometry("520x520")
        self.resizable(False, False)
        self.configure(fg_color=COLORS["bg"])
        self.transient(master)
        self.grab_set()
        self.after(120, self.focus_name)

        pad = {"padx": 24, "pady": (0, 8)}

        heading = ctk.CTkLabel(
            self,
            text=title,
            font=ctk.CTkFont(family=FONT, size=20, weight="bold"),
            text_color=COLORS["text"],
        )
        heading.pack(anchor="w", padx=24, pady=(24, 4))

        ctk.CTkLabel(self, text="Name *", font=ctk.CTkFont(family=FONT, size=13),
                     text_color=COLORS["muted"]).pack(anchor="w", **pad)
        self.name_entry = ctk.CTkEntry(
            self, height=38, font=ctk.CTkFont(family=FONT, size=14),
            fg_color=COLORS["card"], border_color=COLORS["border"], text_color=COLORS["text"],
        )
        self.name_entry.pack(fill="x", padx=24)

        ctk.CTkLabel(self, text="URL *", font=ctk.CTkFont(family=FONT, size=13),
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24, pady=(12, 8))
        self.url_entry = ctk.CTkEntry(
            self, height=38, font=ctk.CTkFont(family=FONT, size=14),
            fg_color=COLORS["card"], border_color=COLORS["border"], text_color=COLORS["text"],
        )
        self.url_entry.pack(fill="x", padx=24)

        ctk.CTkLabel(self, text="Description / Notes", font=ctk.CTkFont(family=FONT, size=13),
                     text_color=COLORS["muted"]).pack(anchor="w", padx=24, pady=(12, 8))
        self.notes_box = ctk.CTkTextbox(
            self, height=130, font=ctk.CTkFont(family=FONT, size=13),
            fg_color=COLORS["card"], border_color=COLORS["border"], border_width=1,
            text_color=COLORS["text"],
        )
        self.notes_box.pack(fill="x", padx=24)

        self.error_label = ctk.CTkLabel(
            self, text="", font=ctk.CTkFont(family=FONT, size=12), text_color=COLORS["danger"]
        )
        self.error_label.pack(anchor="w", padx=24, pady=(10, 2))

        btn_row = ctk.CTkFrame(self, fg_color="transparent")
        btn_row.pack(fill="x", padx=24, pady=(6, 20))
        btn_row.grid_columnconfigure(0, weight=1)

        ctk.CTkButton(
            btn_row, text="Cancel", width=110, height=38,
            font=ctk.CTkFont(family=FONT, size=14),
            fg_color="transparent", border_width=1, border_color=COLORS["border"],
            text_color=COLORS["muted"], hover_color=COLORS["bg"],
            command=self.destroy,
        ).grid(row=0, column=0, sticky="e", padx=(0, 10))

        ctk.CTkButton(
            btn_row, text="Save", width=110, height=38,
            font=ctk.CTkFont(family=FONT, size=14, weight="bold"),
            fg_color=COLORS["primary"], hover_color=COLORS["primary_hover"],
            command=self.save,
        ).grid(row=0, column=1, sticky="e")

        self.name_entry.insert(0, self.resource.get("name", ""))
        self.url_entry.insert(0, self.resource.get("url", ""))
        if self.resource.get("notes"):
            self.notes_box.insert("1.0", self.resource["notes"])

        self.bind("<Escape>", lambda e: self.destroy())
        self.name_entry.bind("<Return>", lambda e: self.url_entry.focus_set())
        self.url_entry.bind("<Return>", lambda e: self.notes_box.focus_set())

    def focus_name(self):
        self.name_entry.focus_set()

    def save(self):
        name = self.name_entry.get().strip()
        url = normalize_url(self.url_entry.get())
        notes = self.notes_box.get("1.0", "end").strip()
        if not name:
            self.error_label.configure(text="Name is required.")
            self.name_entry.focus_set()
            return
        if not url:
            self.error_label.configure(text="URL is required.")
            self.url_entry.focus_set()
            return
        self.on_save({"name": name, "url": url, "notes": notes})
        self.destroy()


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("system")
        self.title(APP_TITLE)
        self.geometry("1060x700")
        self.minsize(880, 600)
        self.configure(fg_color=COLORS["bg"])

        self.resources = load_resources()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self.build_header()
        self.build_list()
        self.build_statusbar()

        self.render()
        self.bind("<Control-n>", lambda e: self.open_dialog(None))

        if os.environ.get("RM_SMOKE_TEST"):
            self.after(1500, self.destroy)

    def build_header(self):
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=28, pady=(22, 10))
        header.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(
            header, text="Resource Manager",
            font=ctk.CTkFont(family=FONT, size=26, weight="bold"),
            text_color=COLORS["text"],
        ).grid(row=0, column=0, sticky="w")

        self.search_var = ctk.StringVar()
        self.search_var.trace_add("write", lambda *a: self.render())
        search = ctk.CTkEntry(
            header, width=340, height=40, placeholder_text="Search by name, URL or notes...",
            font=ctk.CTkFont(family=FONT, size=14),
            textvariable=self.search_var,
            fg_color=COLORS["card"], border_color=COLORS["border"], text_color=COLORS["text"],
        )
        search.grid(row=0, column=1, sticky="e", padx=16)

        ctk.CTkButton(
            header, text="+ Add New", width=120, height=40,
            font=ctk.CTkFont(family=FONT, size=14, weight="bold"),
            fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
            command=lambda: self.open_dialog(None),
        ).grid(row=0, column=2, sticky="e")

    def build_list(self):
        container = ctk.CTkFrame(self, fg_color="transparent")
        container.grid(row=1, column=0, sticky="nsew", padx=28, pady=(4, 4))
        container.grid_rowconfigure(0, weight=1)
        container.grid_columnconfigure(0, weight=1)

        self.scroll = ctk.CTkScrollableFrame(container, fg_color="transparent")
        self.scroll.grid(row=0, column=0, sticky="nsew")

    def build_statusbar(self):
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=2, column=0, sticky="ew", padx=28, pady=(2, 14))

        self.count_label = ctk.CTkLabel(
            bar, text="", font=ctk.CTkFont(family=FONT, size=12), text_color=COLORS["muted"]
        )
        self.count_label.pack(side="left")

        ctk.CTkLabel(
            bar, text=DATA_FILE, font=ctk.CTkFont(family=FONT, size=11),
            text_color=COLORS["muted"],
        ).pack(side="right")

    def filtered_resources(self):
        query = self.search_var.get().strip().lower()
        items = sorted(self.resources, key=lambda r: r.get("name", "").lower())
        if not query:
            return items
        return [
            r for r in items
            if query in r.get("name", "").lower()
            or query in r.get("url", "").lower()
            or query in r.get("notes", "").lower()
        ]

    def render(self):
        for widget in self.scroll.winfo_children():
            widget.destroy()

        items = self.filtered_resources()
        total = len(self.resources)
        self.count_label.configure(text=f"{total} resource{'s' if total != 1 else ''} saved | showing {len(items)}")

        if not items:
            message = (
                "No resources yet. Click '+ Add New' to save your first website."
                if not self.resources else
                "No matching resources found."
            )
            empty = ctk.CTkFrame(self.scroll, fg_color=COLORS["card"], corner_radius=10,
                                 border_width=1, border_color=COLORS["border"])
            empty.pack(fill="x", pady=18, ipady=30)
            ctk.CTkLabel(
                empty, text=message, font=ctk.CTkFont(family=FONT, size=14),
                text_color=COLORS["muted"],
            ).pack()
            return

        for res in items:
            self.make_card(res)

    def make_card(self, res):
        card = ctk.CTkFrame(self.scroll, fg_color=COLORS["card"], corner_radius=10,
                            border_width=1, border_color=COLORS["border"])
        card.pack(fill="x", pady=5)
        card.grid_columnconfigure(0, weight=1)

        head = ctk.CTkFrame(card, fg_color="transparent")
        head.grid(row=0, column=0, sticky="ew", padx=16, pady=(12, 0))
        head.grid_columnconfigure(0, weight=1)

        name_lbl = ctk.CTkLabel(
            head, text=res.get("name", ""),
            font=ctk.CTkFont(family=FONT, size=15, weight="bold"),
            text_color=COLORS["text"], anchor="w",
        )
        name_lbl.grid(row=0, column=0, sticky="w")
        name_lbl.bind("<Double-Button-1>", lambda e, r=res: self.open_url(r))

        ctk.CTkButton(
            head, text="Open", width=78, height=30,
            font=ctk.CTkFont(family=FONT, size=13),
            fg_color=COLORS["primary"], hover_color=COLORS["primary_hover"],
            command=lambda r=res: self.open_url(r),
        ).grid(row=0, column=1, padx=(0, 8))

        ctk.CTkButton(
            head, text="Edit", width=70, height=30,
            font=ctk.CTkFont(family=FONT, size=13),
            fg_color="transparent", border_width=1, border_color=COLORS["border"],
            text_color=COLORS["muted"], hover_color=COLORS["bg"],
            command=lambda r=res: self.open_dialog(r),
        ).grid(row=0, column=2, padx=(0, 8))

        ctk.CTkButton(
            head, text="Delete", width=70, height=30,
            font=ctk.CTkFont(family=FONT, size=13),
            fg_color=COLORS["danger"], hover_color=COLORS["danger_hover"],
            command=lambda r=res: self.delete_resource(r),
        ).grid(row=0, column=3)

        ctk.CTkLabel(
            card, text=res.get("url", ""), anchor="w",
            font=ctk.CTkFont(family=FONT, size=12),
            text_color=COLORS["primary"],
        ).grid(row=1, column=0, sticky="w", padx=18, pady=(2, 0))

        notes = res.get("notes", "").strip()
        if notes:
            snippet = notes if len(notes) <= 220 else notes[:220].rstrip() + "..."
            ctk.CTkLabel(
                card, text=snippet, anchor="w", justify="left",
                font=ctk.CTkFont(family=FONT, size=12),
                text_color=COLORS["muted"], wraplength=880,
            ).grid(row=2, column=0, sticky="w", padx=18, pady=(4, 12))
        else:
            spacer = ctk.CTkFrame(card, fg_color="transparent", height=12)
            spacer.grid(row=2, column=0)

    def open_url(self, res):
        url = normalize_url(res.get("url", ""))
        if url:
            webbrowser.open(url)

    def delete_resource(self, res):
        confirm = messagebox.askyesno(
            APP_TITLE,
            f"Delete '{res.get('name', '')}'?\nThis cannot be undone.",
            parent=self,
        )
        if not confirm:
            return
        self.resources = [r for r in self.resources if r.get("id") != res.get("id")]
        self.persist_and_render()

    def open_dialog(self, resource):
        editing = resource is not None

        def handle_save(data):
            if editing:
                data["id"] = resource["id"]
                data["created"] = resource.get("created")
                data["updated"] = datetime.now().isoformat(timespec="seconds")
                self.resources = [
                    data if r.get("id") == resource["id"] else r for r in self.resources
                ]
            else:
                data["id"] = str(uuid.uuid4())
                data["created"] = datetime.now().isoformat(timespec="seconds")
                self.resources.append(data)
            self.persist_and_render()

        ResourceDialog(
            self,
            "Edit Resource" if editing else "Add New Resource",
            handle_save,
            resource,
        )

    def persist_and_render(self):
        save_resources(self.resources)
        self.render()


if __name__ == "__main__":
    app = App()
    app.mainloop()
