import { pool, transaction, one } from "./src.js";
import { passwordHash, assert } from "../domain/src/index.js";
assert(
  process.env.ALLOW_DEMO_SEED === "true" &&
    process.env.NODE_ENV !== "production",
  "DISABLED",
  "Demo seed is disabled",
);
const password = process.env.DEMO_PASSWORD;
assert(
  password && password.length >= 12,
  "PASSWORD",
  "Set DEMO_PASSWORD with at least 12 characters",
);
await transaction(async (db) => {
  if (await one(db, "SELECT id FROM organization WHERE name='Tokenex Demo'")) {
    console.log("Demo already seeded; existing data preserved");
    return;
  }
  const org = await one(
    db,
    "INSERT INTO organization(name) VALUES('Tokenex Demo') RETURNING id",
  );
  const venue = await one(
    db,
    "INSERT INTO venue(organization_id,name) VALUES($1,'The Courtyard') RETURNING id",
    [org.id],
  );
  const dhaara = await one(
    db,
    "INSERT INTO outlet(venue_id,name,cuisine,collection_point) VALUES($1,'Dhaara Tiffins','South Indian','Counter 01') RETURNING id",
    [venue.id],
  );
  const wok = await one(
    db,
    "INSERT INTO outlet(venue_id,name,cuisine,collection_point) VALUES($1,'Wok & Bowl','Asian','Counter 02') RETURNING id",
    [venue.id],
  );
  const stations = [];
  for (const [outlet, name, kind] of [
    [dhaara.id, "Dosa cook", "PREP"],
    [dhaara.id, "Quick service", "QUICK_SERVICE"],
    [wok.id, "Wok station", "PREP"],
  ])
    stations.push(
      await one(
        db,
        "INSERT INTO station(outlet_id,name,kind) VALUES($1,$2,$3) RETURNING id",
        [outlet, name, kind],
      ),
    );
  await db.query("UPDATE outlet SET default_station_id=$1 WHERE id=$2", [
    stations[0].id,
    dhaara.id,
  ]);
  await db.query("UPDATE outlet SET default_station_id=$1 WHERE id=$2", [
    stations[2].id,
    wok.id,
  ]);
  for (const [outlet, station, name, price, image, desc] of [
    [
      dhaara.id,
      stations[0].id,
      "Masala dosa",
      10000,
      "dosa",
      "Golden rice crepe, potato masala, coconut chutney.",
    ],
    [
      dhaara.id,
      stations[0].id,
      "Ghee roast dosa",
      14000,
      "dosa",
      "Crisp, aromatic and finished with pure ghee.",
    ],
    [
      dhaara.id,
      stations[1].id,
      "Idli plate",
      5000,
      "idli",
      "Steamed rice cakes, sambar and fresh chutney.",
    ],
    [
      dhaara.id,
      stations[1].id,
      "Filter coffee",
      4000,
      "coffee",
      "Slow-brewed South Indian coffee.",
    ],
    [
      wok.id,
      stations[2].id,
      "Vegetable fried rice",
      15000,
      "rice",
      "Wok-tossed rice, fresh vegetables and spring onion.",
    ],
    [
      wok.id,
      stations[2].id,
      "Chilli garlic noodles",
      17000,
      "noodles",
      "Noodles tossed over high heat with garlic and chilli.",
    ],
  ])
    await db.query(
      "INSERT INTO menu_item(outlet_id,station_id,name,price_minor,image_url,image_alt,description,published) VALUES($1,$2,$3,$4,$5,$3,$6,true)",
      [outlet, station, name, price, `/images/${image}.svg`, desc],
    );
  const roles = [
    ["admin", "SUPER_ADMIN", null, null],
    ["owner", "OWNER", dhaara.id, null],
    ["wok-owner", "OWNER", wok.id, null],
    ["manager", "MANAGER", null, null],
    ["billing", "BILLING", null, null],
    ["cook", "COOK", dhaara.id, stations[0].id],
    ["quick", "COOK", dhaara.id, stations[1].id],
    ["server", "SERVER", dhaara.id, null],
    ["kiosk", "KIOSK", null, null],
    ["display", "DISPLAY", null, null],
  ];
  for (const [name, role, outlet, station] of roles) {
    const u = await one(
      db,
      "INSERT INTO app_user(organization_id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id",
      [org.id, `${name}@tokenex.local`, name, passwordHash(password)],
    );
    await db.query(
      "INSERT INTO role_assignment(user_id,venue_id,outlet_id,station_id,role,capabilities) VALUES($1,$2,$3,$4,$5,$6)",
      [
        u.id,
        venue.id,
        outlet,
        station,
        role,
        role === "MANAGER" ? ["finance"] : [],
      ],
    );
    if (name === "quick")
      await db.query(
        "INSERT INTO role_assignment(user_id,venue_id,outlet_id,role) VALUES($1,$2,$3,'SERVER')",
        [u.id, venue.id, dhaara.id],
      );
  }
  for (const [name, kind] of [
    ["Central POS", "POS"],
    ["Kiosk 01", "KIOSK"],
    ["Kiosk 02", "KIOSK"],
    ["Kitchen display", "KITCHEN"],
  ])
    await db.query("INSERT INTO device(venue_id,name,kind) VALUES($1,$2,$3)", [
      venue.id,
      name,
      kind,
    ]);
  console.log(
    "Seeded The Courtyard, two outlets, three stations and 10 scoped demo accounts.",
  );
});
await pool.end();
