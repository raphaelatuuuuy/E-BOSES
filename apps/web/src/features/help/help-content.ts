import {
  BadgeCheckIcon,
  BellIcon,
  GlobeIcon,
  ListChecksIcon,
  MegaphoneIcon,
  ScaleIcon,
  ShieldIcon,
  SirenIcon,
  UserPlusIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import type { HelpLocale } from "./help-language"

export interface Localized {
  en: string
  fil: string
}

export type HelpBlock =
  | { kind: "text"; body: Localized }
  | { kind: "steps"; items: Localized[] }
  | { kind: "list"; items: Localized[] }
  | { kind: "note"; body: Localized }

export interface HelpArticle {
  slug: string
  title: Localized
  subtitle: Localized
  updated: Localized
  blocks: HelpBlock[]
}

export interface HelpCollection {
  slug: string
  title: Localized
  description: Localized
  icon: LucideIcon
  articles: HelpArticle[]
}

export function pick(value: Localized, locale: HelpLocale): string {
  return value[locale] || value.en
}

const AUG = { en: "August 2026", fil: "Agosto 2026" }

export const HELP_COLLECTIONS: HelpCollection[] = [
  {
    slug: "account-and-sign-up",
    title: { en: "Account and sign up", fil: "Account at pagpaparehistro" },
    description: {
      en: "Creating an E-Boses account and what you need to prepare",
      fil: "Paggawa ng E-Boses account at kung ano ang ihahanda",
    },
    icon: UserPlusIcon,
    articles: [
      {
        slug: "create-an-account",
        title: { en: "How do I create an E-Boses account?", fil: "Paano gumawa ng E-Boses account?" },
        subtitle: {
          en: "The sign up steps from start to finish.",
          fil: "Ang mga hakbang sa pagpaparehistro mula simula hanggang matapos.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "E-Boses accounts are for residents of Barangay Marikina Heights. Registration takes a few minutes and needs a working mobile number.",
              fil: "Ang E-Boses account ay para sa mga residente ng Barangay Marikina Heights. Ilang minuto lang ang pagpaparehistro at kailangan ng gumaganang cellphone number.",
            },
          },
          {
            kind: "steps",
            items: [
              {
                en: "Open the app and select Create an account.",
                fil: "Buksan ang app at piliin ang Create an account.",
              },
              {
                en: "Enter your full name, date of birth, and mobile number.",
                fil: "Ilagay ang buong pangalan, petsa ng kapanganakan, at cellphone number.",
              },
              {
                en: "Enter the one time password sent to your mobile number.",
                fil: "Ilagay ang one time password na ipinadala sa inyong cellphone number.",
              },
              {
                en: "Provide your home address, including your street and house number.",
                fil: "Ibigay ang inyong tirahan, kasama ang kalye at house number.",
              },
              {
                en: "Upload a document that shows you live in the barangay.",
                fil: "Mag-upload ng dokumentong nagpapatunay na naninirahan kayo sa barangay.",
              },
              {
                en: "Submit the form. The app checks your document on its own.",
                fil: "I-submit ang form. Ang app na mismo ang magsusuri sa inyong dokumento.",
              },
            ],
          },
          {
            kind: "note",
            body: {
              en: "The check is automatic, so the result usually arrives within a few minutes. You will be notified once it is done, and you can sign in as soon as your account is approved.",
              fil: "Awtomatiko ang pagsusuri, kaya karaniwang ilang minuto lang ang resulta. Aabisuhan kayo kapag tapos na, at makakapag-sign in agad kapag naaprubahan ang account.",
            },
          },
        ],
      },
      {
        slug: "what-information-is-required",
        title: {
          en: "What information is required to register?",
          fil: "Anong impormasyon ang kailangan sa pagpaparehistro?",
        },
        subtitle: {
          en: "The details asked for during sign up and why.",
          fil: "Ang mga hinihinging detalye at kung bakit ito kailangan.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Full name, as written on your valid identification.",
                fil: "Buong pangalan, gaya ng nakasulat sa inyong valid ID.",
              },
              { en: "Date of birth.", fil: "Petsa ng kapanganakan." },
              {
                en: "Active Philippine mobile number, used for the one time password and for alerts.",
                fil: "Aktibong Philippine cellphone number, gagamitin sa one time password at sa mga alerto.",
              },
              {
                en: "Home address within Barangay Marikina Heights.",
                fil: "Tirahan sa loob ng Barangay Marikina Heights.",
              },
              {
                en: "A document showing your residency, such as a barangay certificate or a utility bill.",
                fil: "Dokumentong patunay ng paninirahan, tulad ng barangay certificate o bill ng kuryente o tubig.",
              },
            ],
          },
          {
            kind: "text",
            body: {
              en: "Your address is used to route your reports to the correct barangay staff and to show alerts that affect your street. It is not shown publicly on the community feed.",
              fil: "Ginagamit ang inyong address para maipadala ang report sa tamang tauhan ng barangay at para maipakita ang mga alertong may kinalaman sa inyong kalye. Hindi ito lumalabas sa community feed.",
            },
          },
        ],
      },
      {
        slug: "who-can-register",
        title: { en: "Who can register for an account?", fil: "Sino ang puwedeng magparehistro?" },
        subtitle: {
          en: "Eligibility for residents of the barangay.",
          fil: "Kwalipikasyon para sa mga residente ng barangay.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Any resident of Barangay Marikina Heights who is at least 18 years old may register, using a Philippine mobile number. One account is allowed per mobile number.",
              fil: "Puwedeng magparehistro ang sinumang residente ng Barangay Marikina Heights na 18 taong gulang pataas, gamit ang Philippine cellphone number. Isang account lang bawat cellphone number.",
            },
          },
          {
            kind: "text",
            body: {
              en: "If you live in the barangay but your document is under another name, such as a parent or a landlord, submit it anyway and add a short note explaining it.",
              fil: "Kung nakatira kayo sa barangay pero nasa pangalan ng iba ang dokumento, gaya ng magulang o kasera, i-submit pa rin ito at maglagay ng maikling paliwanag.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "verifying-your-residency",
    title: { en: "Verifying your residency", fil: "Pagpapatunay ng paninirahan" },
    description: {
      en: "How the barangay confirms your address and how long it takes",
      fil: "Paano kinukumpirma ng barangay ang inyong address at gaano ito katagal",
    },
    icon: BadgeCheckIcon,
    articles: [
      {
        slug: "how-verification-works",
        title: {
          en: "How does residency verification work?",
          fil: "Paano ang proseso ng pagpapatunay ng paninirahan?",
        },
        subtitle: {
          en: "What happens after you submit your document.",
          fil: "Ang mangyayari matapos ninyong i-submit ang dokumento.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "The app checks every new account on its own. Nobody has to open your document by hand for the usual case, so you do not wait in a queue.",
              fil: "Ang app na mismo ang sumusuri sa bawat bagong account. Sa karaniwang kaso, walang taong kailangang magbukas ng inyong dokumento, kaya hindi kayo pumipila.",
            },
          },
          {
            kind: "steps",
            items: [
              {
                en: "The app reads the address on your uploaded document.",
                fil: "Binabasa ng app ang address sa na-upload ninyong dokumento.",
              },
              {
                en: "It compares that address with the one you typed during sign up.",
                fil: "Inihahambing nito ang address na iyon sa inilagay ninyo noong nagparehistro.",
              },
              {
                en: "If they match, your account is approved right away and you get a message.",
                fil: "Kung magkatugma, agad na naaaprubahan ang account ninyo at makakatanggap kayo ng mensahe.",
              },
            ],
          },
          {
            kind: "note",
            body: {
              en: "You usually get the result within a few minutes. If the document cannot be read clearly, you will simply be asked to upload a better photo.",
              fil: "Karaniwang ilang minuto lang bago dumating ang resulta. Kung hindi mabasa nang malinaw ang dokumento, hihilingin lang sa inyong mag-upload ng mas malinaw na litrato.",
            },
          },
        ],
      },
      {
        slug: "accepted-documents",
        title: { en: "Which documents are accepted?", fil: "Anong mga dokumento ang tinatanggap?" },
        subtitle: {
          en: "Proof of residency that the barangay can verify.",
          fil: "Mga patunay ng paninirahan na kayang beripikahin ng barangay.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Barangay certificate or barangay clearance.",
                fil: "Barangay certificate o barangay clearance.",
              },
              {
                en: "Utility bill showing your name and address.",
                fil: "Bill ng kuryente o tubig na may pangalan at address ninyo.",
              },
              {
                en: "Valid government identification showing your address.",
                fil: "Valid na government ID na may nakalagay na address.",
              },
              { en: "Lease or rental agreement.", fil: "Kontrata sa upa o rental agreement." },
            ],
          },
          {
            kind: "text",
            body: {
              en: "Photograph the whole document in good light and make sure the address is readable. The app cannot read a blurred or cropped image, so it will ask you to upload another one.",
              fil: "Kunan ng litrato ang buong dokumento sa maliwanag na lugar at siguraduhing mababasa ang address. Hindi mabasa ng app ang malabo o putol na litrato, kaya hihilingin nitong mag-upload kayo ulit.",
            },
          },
        ],
      },
      {
        slug: "verification-was-returned",
        title: {
          en: "My verification was returned. What do I do?",
          fil: "Naibalik ang aking verification. Ano ang gagawin ko?",
        },
        subtitle: {
          en: "Common reasons and how to correct them.",
          fil: "Mga karaniwang dahilan at paano ito ayusin.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "The address on the document does not match the address you entered.",
                fil: "Hindi tugma ang address sa dokumento at ang address na inilagay ninyo.",
              },
              {
                en: "The document image is blurred, cropped, or too dark to read.",
                fil: "Malabo, putol, o masyadong madilim ang litrato ng dokumento.",
              },
              { en: "The document has expired.", fil: "Expired na ang dokumento." },
            ],
          },
          {
            kind: "text",
            body: {
              en: "Sign in, open your account settings, and upload a corrected document. You do not need to register again.",
              fil: "Mag-sign in, buksan ang account settings, at mag-upload ng tamang dokumento. Hindi na kailangang magparehistro ulit.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "reporting-a-concern",
    title: { en: "Reporting a concern", fil: "Pag-uulat ng problema" },
    description: {
      en: "Submitting a local concern and what happens to it",
      fil: "Pagsusumite ng lokal na problema at kung ano ang mangyayari dito",
    },
    icon: MegaphoneIcon,
    articles: [
      {
        slug: "how-to-report-a-concern",
        title: { en: "How do I report a concern?", fil: "Paano mag-ulat ng problema?" },
        subtitle: {
          en: "Submitting a non urgent issue to the barangay.",
          fil: "Pagsusumite ng hindi agarang isyu sa barangay.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "A concern is a local issue that needs barangay attention but is not an emergency, such as uncollected rubbish, a broken street light, or a blocked drain.",
              fil: "Ang concern ay lokal na isyung kailangang aksyunan ng barangay pero hindi emergency, tulad ng hindi nakolektang basura, sirang poste ng ilaw, o baradong kanal.",
            },
          },
          {
            kind: "steps",
            items: [
              {
                en: "Select Create a report from your home feed.",
                fil: "Piliin ang Create a report sa inyong home feed.",
              },
              {
                en: "Choose the category that best matches the issue.",
                fil: "Piliin ang kategoryang bagay sa isyu.",
              },
              {
                en: "Describe what you observed in your own words.",
                fil: "Ilarawan sa sarili ninyong salita ang inyong nakita.",
              },
              { en: "Add a photo if you have one.", fil: "Maglakip ng litrato kung mayroon kayo." },
              { en: "Confirm the location on the map.", fil: "Kumpirmahin ang lokasyon sa mapa." },
              { en: "Submit the report.", fil: "I-submit ang report." },
            ],
          },
          {
            kind: "note",
            body: {
              en: "For anything that puts life or property at immediate risk, use the emergency button instead.",
              fil: "Kung may agarang panganib sa buhay o ari-arian, gamitin ang emergency button.",
            },
          },
        ],
      },
      {
        slug: "what-makes-a-good-report",
        title: {
          en: "What makes a report easy to act on?",
          fil: "Ano ang nagpapadali sa pag-aksyon sa isang report?",
        },
        subtitle: {
          en: "Details that help barangay staff respond faster.",
          fil: "Mga detalyeng nakakatulong para mas mabilis tumugon ang barangay.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Name the street and the nearest landmark.",
                fil: "Banggitin ang kalye at ang pinakamalapit na palatandaan.",
              },
              {
                en: "Say how long the issue has been there.",
                fil: "Sabihin kung gaano na katagal ang isyu.",
              },
              {
                en: "Describe what you can see rather than what you think caused it.",
                fil: "Ilarawan ang inyong nakikita sa halip na ang inaakala ninyong dahilan.",
              },
              {
                en: "Attach one clear photo taken from a safe distance.",
                fil: "Maglakip ng isang malinaw na litratong kuha mula sa ligtas na distansya.",
              },
            ],
          },
        ],
      },
      {
        slug: "someone-already-reported-this",
        title: {
          en: "Someone already reported the same issue",
          fil: "May nag-ulat na ng ganitong isyu",
        },
        subtitle: {
          en: "How duplicate reports are grouped.",
          fil: "Paano pinagsasama ang magkakatulad na report.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "When several residents report the same issue at the same place, E-Boses groups them into one item. The feed shows how many neighbours reported it, which tells the barangay how widely it is felt.",
              fil: "Kapag maraming residente ang nag-ulat ng parehong isyu sa parehong lugar, pinagsasama ito ng E-Boses sa isang item. Ipinapakita sa feed kung ilang kapitbahay ang nag-ulat, para malaman ng barangay kung gaano ito kalawak.",
            },
          },
          {
            kind: "text",
            body: {
              en: "Submit your report even if you think it exists already. Grouping happens automatically and your description is kept with the group.",
              fil: "I-submit pa rin ang inyong report kahit sa tingin ninyo ay meron na. Awtomatiko ang pagsasama at nananatili ang inyong paglalarawan sa grupo.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "emergency-reporting",
    title: { en: "Emergency reporting", fil: "Pag-uulat ng emergency" },
    description: {
      en: "Sending an urgent alert when someone is at risk",
      fil: "Pagpapadala ng agarang alerto kapag may nanganganib",
    },
    icon: SirenIcon,
    articles: [
      {
        slug: "how-to-report-an-emergency",
        title: { en: "How do I report an emergency?", fil: "Paano mag-ulat ng emergency?" },
        subtitle: {
          en: "Sending an alert that reaches responders immediately.",
          fil: "Pagpapadala ng alertong agad na aabot sa mga responder.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Use the emergency button for fire, flooding, medical emergencies, road accidents, or anything that puts life or property at immediate risk.",
              fil: "Gamitin ang emergency button para sa sunog, baha, medical emergency, aksidente sa kalsada, o anumang agarang panganib sa buhay o ari-arian.",
            },
          },
          {
            kind: "steps",
            items: [
              {
                en: "Select the emergency button on your home screen.",
                fil: "Pindutin ang emergency button sa inyong home screen.",
              },
              { en: "Choose the type of emergency.", fil: "Piliin ang uri ng emergency." },
              { en: "Confirm your location.", fil: "Kumpirmahin ang inyong lokasyon." },
              {
                en: "Add a short description if it is safe to do so.",
                fil: "Magdagdag ng maikling paliwanag kung ligtas gawin ito.",
              },
              {
                en: "Submit the alert and stay reachable on your mobile number.",
                fil: "I-submit ang alerto at panatilihing bukas ang inyong cellphone.",
              },
            ],
          },
          {
            kind: "note",
            body: {
              en: "If you are in danger, move to safety first. You can also call the Marikina City hotline 161 directly.",
              fil: "Kung nasa panganib kayo, lumikas muna sa ligtas na lugar. Puwede rin kayong tumawag agad sa Marikina City hotline 161.",
            },
          },
        ],
      },
      {
        slug: "what-happens-after-an-alert",
        title: {
          en: "What happens after I send an alert?",
          fil: "Ano ang mangyayari matapos magpadala ng alerto?",
        },
        subtitle: { en: "How an emergency is handled.", fil: "Paano hinahawakan ang emergency." },
        updated: AUG,
        blocks: [
          {
            kind: "steps",
            items: [
              {
                en: "Your alert reaches the barangay operations desk straight away.",
                fil: "Agad na aabot ang alerto sa operations desk ng barangay.",
              },
              {
                en: "A responder is assigned and you can follow the status in the app.",
                fil: "May itatalagang responder at masusubaybayan ninyo ang status sa app.",
              },
              {
                en: "You may be contacted on the mobile number registered to your account.",
                fil: "Maaari kayong tawagan sa cellphone number na nakarehistro sa account ninyo.",
              },
            ],
          },
        ],
      },
      {
        slug: "no-internet-connection",
        title: {
          en: "Can I report without an internet connection?",
          fil: "Puwede bang mag-ulat kahit walang internet?",
        },
        subtitle: {
          en: "Sending an alert by text message.",
          fil: "Pagpapadala ng alerto sa pamamagitan ng text.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "If your connection drops, E-Boses can fall back to a text message so your alert still reaches the barangay. Keep load or a text allowance on the number registered to your account.",
              fil: "Kapag nawalan ng koneksyon, puwedeng gumamit ang E-Boses ng text para makarating pa rin ang alerto sa barangay. Panatilihing may load o text allowance ang nakarehistrong number ninyo.",
            },
          },
          {
            kind: "text",
            body: {
              en: "Text is plain text, so it cannot carry a photo. If you have a photo, we will text you a link you can use to upload it later.",
              fil: "Text lang ito kaya hindi kayang magdala ng litrato. Kung may litrato po kayo, tetext namin ang link na magagamit ninyo sa pag-upload.",
            },
          },
          {
            kind: "text",
            body: {
              en: "You do not need to remember exact wording. Send HELP followed by the type of emergency and the place, for example HELP FIRE Champaca Street. Send GUIDE and we will text you the full list.",
              fil: "Hindi po kailangang tamang-tama ang pagkakasulat. I-text ang HELP, ang uri ng emergency, at ang lugar, halimbawa HELP FIRE Champaca Street. I-text ang GUIDE at ipapadala namin ang buong listahan.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "tracking-your-report",
    title: { en: "Tracking your report", fil: "Pagsubaybay sa inyong report" },
    description: {
      en: "Following the status of something you submitted",
      fil: "Pagsubaybay sa status ng inyong isinumite",
    },
    icon: ListChecksIcon,
    articles: [
      {
        slug: "where-to-see-status",
        title: {
          en: "Where do I see the status of my report?",
          fil: "Saan makikita ang status ng aking report?",
        },
        subtitle: { en: "Finding your submitted items.", fil: "Paghahanap sa mga isinumite ninyo." },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Open your home feed and select your report. The status is shown at the top of the item, together with any update the barangay has posted.",
              fil: "Buksan ang home feed at piliin ang inyong report. Nasa itaas ng item ang status, kasama ang anumang update na inilagay ng barangay.",
            },
          },
        ],
      },
      {
        slug: "what-the-statuses-mean",
        title: { en: "What do the statuses mean?", fil: "Ano ang ibig sabihin ng bawat status?" },
        subtitle: {
          en: "Reading the progress of a concern.",
          fil: "Pag-unawa sa takbo ng isang concern.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Under review: the barangay has received the report and is assessing it.",
                fil: "Under review: natanggap na ng barangay ang report at sinusuri ito.",
              },
              {
                en: "In progress: the report has been assigned and work has started.",
                fil: "In progress: naitalaga na ang report at nagsimula na ang trabaho.",
              },
              {
                en: "Resolved: the barangay has completed the work and posted an update.",
                fil: "Resolved: tapos na ang trabaho at may nakalagay nang update ang barangay.",
              },
              {
                en: "Partially resolved: some of the issue has been addressed and the rest is ongoing.",
                fil: "Partially resolved: may naayos na bahagi at patuloy pa ang natitira.",
              },
            ],
          },
        ],
      },
      {
        slug: "no-update-yet",
        title: {
          en: "My report has had no update. What can I do?",
          fil: "Walang update ang aking report. Ano ang puwede kong gawin?",
        },
        subtitle: { en: "When to follow up.", fil: "Kailan dapat mag-follow up." },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Add a comment on your report to ask for an update. Barangay staff see comments on the item itself, so there is no need to submit the same report again.",
              fil: "Mag-comment sa inyong report para humingi ng update. Nakikita ng barangay ang mga comment sa mismong item, kaya hindi na kailangang mag-submit ulit.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "barangay-announcements",
    title: { en: "Barangay announcements", fil: "Mga anunsyo ng barangay" },
    description: {
      en: "Advisories, events, and updates posted by the barangay",
      fil: "Mga abiso, kaganapan, at update mula sa barangay",
    },
    icon: GlobeIcon,
    articles: [
      {
        slug: "where-announcements-appear",
        title: { en: "Where do announcements appear?", fil: "Saan lumalabas ang mga anunsyo?" },
        subtitle: {
          en: "Finding advisories that affect your street.",
          fil: "Paghahanap ng mga abisong may kinalaman sa inyong kalye.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Announcements appear at the top of your home feed. Each one shows the advisory type, the date, and the streets affected where relevant.",
              fil: "Lumalabas ang mga anunsyo sa itaas ng home feed. Makikita sa bawat isa ang uri ng abiso, ang petsa, at ang mga kalyeng apektado kung meron.",
            },
          },
        ],
      },
      {
        slug: "commenting-on-announcements",
        title: { en: "Can I comment on an announcement?", fil: "Puwede bang mag-comment sa anunsyo?" },
        subtitle: {
          en: "Asking a question about an advisory.",
          fil: "Pagtatanong tungkol sa isang abiso.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Yes. Select the comment icon on the announcement to open the thread and post a question. Barangay staff can reply, and their replies are marked as official.",
              fil: "Opo. Pindutin ang comment icon sa anunsyo para buksan ang thread at magtanong. Puwedeng sumagot ang barangay, at may markang official ang kanilang sagot.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "privacy-and-your-data",
    title: { en: "Privacy and your data", fil: "Privacy at ang inyong datos" },
    description: {
      en: "What is shown publicly and how photos are handled",
      fil: "Kung ano ang nakikita ng publiko at paano hinahawakan ang mga litrato",
    },
    icon: ShieldIcon,
    articles: [
      {
        slug: "is-my-data-secure",
        title: { en: "Is my data secure?", fil: "Ligtas ba ang aking datos?" },
        subtitle: {
          en: "How your information is stored and used.",
          fil: "Paano iniimbak at ginagamit ang inyong impormasyon.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Your account details, including your address and your uploaded document, are visible only to authorised barangay staff. They are not shown on the community feed.",
              fil: "Ang detalye ng inyong account, kasama ang address at na-upload na dokumento, ay nakikita lang ng awtorisadong tauhan ng barangay. Hindi ito lumalabas sa community feed.",
            },
          },
          {
            kind: "list",
            items: [
              {
                en: "Your exact address is never published with a report.",
                fil: "Hindi kailanman inilalathala ang tumpak ninyong address kasama ng report.",
              },
              {
                en: "Your mobile number is never shown to other residents.",
                fil: "Hindi ipinapakita ang inyong cellphone number sa ibang residente.",
              },
              {
                en: "Access to original uploaded files by staff is recorded.",
                fil: "Naitatala kapag binuksan ng tauhan ang orihinal na na-upload na file.",
              },
            ],
          },
        ],
      },
      {
        slug: "what-neighbours-can-see",
        title: { en: "What can my neighbours see?", fil: "Ano ang nakikita ng aking mga kapitbahay?" },
        subtitle: { en: "The public side of a report.", fil: "Ang pampublikong bahagi ng report." },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Your name and the street the report concerns.",
                fil: "Ang inyong pangalan at ang kalyeng tinutukoy ng report.",
              },
              {
                en: "The category, description, and any attached photo.",
                fil: "Ang kategorya, paglalarawan, at anumang nakalakip na litrato.",
              },
              {
                en: "The status and any official update.",
                fil: "Ang status at anumang opisyal na update.",
              },
            ],
          },
          {
            kind: "text",
            body: {
              en: "You can mark a report as private when you submit it. A private report is seen only by you and by barangay staff.",
              fil: "Puwede ninyong gawing private ang report kapag isinumite ito. Kayo lang at ang barangay ang makakakita ng private na report.",
            },
          },
        ],
      },
      {
        slug: "how-photos-are-handled",
        title: { en: "How are photos handled?", fil: "Paano hinahawakan ang mga litrato?" },
        subtitle: {
          en: "Faces and plates in uploaded images.",
          fil: "Mga mukha at plaka sa mga na-upload na litrato.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Photos are checked before they are published. Human faces and vehicle plates that are found are blurred, and location data stored inside the image file is removed.",
              fil: "Sinusuri ang mga litrato bago ilathala. Bino-blur ang mga mukha ng tao at plaka ng sasakyan na matatagpuan, at tinatanggal ang location data sa loob ng file.",
            },
          },
          {
            kind: "note",
            body: {
              en: "If a photo cannot be checked, it is not published. Barangay staff can still open the original when handling the case.",
              fil: "Kung hindi masuri ang litrato, hindi ito inilalathala. Nabubuksan pa rin ng barangay ang orihinal habang inaasikaso ang kaso.",
            },
          },
        ],
      },
      {
        slug: "privacy-policy",
        title: { en: "Privacy Policy", fil: "Patakaran sa Privacy" },
        subtitle: {
          en: "How the barangay handles the personal information you share.",
          fil: "Paano hinahawakan ng barangay ang personal na impormasyong ibinabahagi ninyo.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "note",
            body: {
              en: "This policy is being finalised by the barangay. The sections below outline what it will cover. Binding language is pending official approval.",
              fil: "Tinatapos pa ng barangay ang patakarang ito. Ang mga bahaging nasa ibaba ang saklaw nito. Hinihintay pa ang opisyal na pag-apruba.",
            },
          },
          {
            kind: "text",
            body: { en: "Information we collect", fil: "Impormasyong kinokolekta namin" },
          },
          {
            kind: "list",
            items: [
              {
                en: "Account details, including your name, contact information, and address.",
                fil: "Detalye ng account, kasama ang pangalan, contact information, at address.",
              },
              {
                en: "Reports you submit and emergency alerts you send.",
                fil: "Mga report na isinusumite at emergency alert na ipinapadala ninyo.",
              },
              {
                en: "Device location shared while you are using the emergency features.",
                fil: "Lokasyon ng device habang ginagamit ang mga emergency feature.",
              },
            ],
          },
          {
            kind: "text",
            body: { en: "How we use your information", fil: "Paano namin ginagamit ang impormasyon" },
          },
          {
            kind: "text",
            body: {
              en: "To respond to reports and emergencies, assign barangay responders, keep you updated on your requests, and improve community services.",
              fil: "Para tumugon sa mga report at emergency, magtalaga ng responder, panatilihin kayong updated sa inyong mga hiling, at pagbutihin ang serbisyo sa komunidad.",
            },
          },
          { kind: "text", body: { en: "Sharing and disclosure", fil: "Pagbabahagi ng impormasyon" } },
          {
            kind: "text",
            body: {
              en: "Information is shared with authorised barangay officials and responders only as needed to act on your report or emergency. It is never sold.",
              fil: "Ibinabahagi lang ang impormasyon sa awtorisadong opisyal at responder kung kinakailangan para aksyunan ang inyong report o emergency. Hindi ito ipinagbibili.",
            },
          },
          { kind: "text", body: { en: "Data retention", fil: "Pag-iingat ng datos" } },
          {
            kind: "text",
            body: {
              en: "Records are kept as long as required to serve your requests and to comply with barangay record keeping obligations, then deleted or anonymised.",
              fil: "Iniingatan ang mga tala hangga't kailangan para matugunan ang inyong hiling at masunod ang obligasyon sa pag-iingat ng rekord, pagkatapos ay binubura o inaalisan ng pagkakakilanlan.",
            },
          },
          { kind: "text", body: { en: "Your rights", fil: "Ang inyong mga karapatan" } },
          {
            kind: "text",
            body: {
              en: "You may access, correct, or request deletion of your personal data, and you may withdraw consent for optional processing at any time.",
              fil: "Puwede ninyong tingnan, itama, o ipabura ang inyong personal na datos, at puwede ninyong bawiin anumang oras ang pahintulot sa opsyonal na paggamit nito.",
            },
          },
          { kind: "text", body: { en: "Contact", fil: "Pakikipag-ugnayan" } },
          {
            kind: "text",
            body: {
              en: "Questions about this policy can be directed to the Barangay Hall of Marikina Heights.",
              fil: "Maaaring ipaabot sa Barangay Hall ng Marikina Heights ang mga tanong tungkol sa patakarang ito.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "notifications-and-sms",
    title: { en: "Notifications and SMS", fil: "Mga notification at SMS" },
    description: {
      en: "How E-Boses reaches you and what you can turn off",
      fil: "Paano kayo naaabot ng E-Boses at ano ang puwedeng patayin",
    },
    icon: BellIcon,
    articles: [
      {
        slug: "what-notifications-you-get",
        title: {
          en: "What notifications will I receive?",
          fil: "Anong mga notification ang matatanggap ko?",
        },
        subtitle: {
          en: "Messages E-Boses sends to residents.",
          fil: "Mga mensaheng ipinapadala ng E-Boses sa mga residente.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Updates on reports you submitted.",
                fil: "Mga update sa report na isinumite ninyo.",
              },
              {
                en: "Replies and comments on your items.",
                fil: "Mga sagot at comment sa inyong mga item.",
              },
              {
                en: "Advisories that affect your street.",
                fil: "Mga abisong may kinalaman sa inyong kalye.",
              },
              {
                en: "Emergency alerts in your barangay.",
                fil: "Mga emergency alert sa inyong barangay.",
              },
            ],
          },
        ],
      },
      {
        slug: "manage-notifications",
        title: {
          en: "How do I change my notification settings?",
          fil: "Paano baguhin ang notification settings?",
        },
        subtitle: { en: "Turning categories on and off.", fil: "Pagbukas at pagsara ng kategorya." },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Open your account settings and select notifications. You can turn categories on or off individually. Emergency alerts for your barangay cannot be turned off.",
              fil: "Buksan ang account settings at piliin ang notifications. Puwede ninyong buksan o isara ang bawat kategorya. Hindi puwedeng patayin ang emergency alert para sa inyong barangay.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "using-e-boses-responsibly",
    title: { en: "Using E-Boses responsibly", fil: "Tamang paggamit ng E-Boses" },
    description: {
      en: "What is fair to report, and what is not allowed",
      fil: "Ano ang tamang iulat, at ano ang hindi pinapayagan",
    },
    icon: ScaleIcon,
    articles: [
      {
        slug: "community-rules",
        title: { en: "What are the rules for using E-Boses?", fil: "Ano ang mga patakaran sa paggamit ng E-Boses?" },
        subtitle: {
          en: "How to keep the feed useful for everyone.",
          fil: "Paano panatilihing kapaki-pakinabang ang feed para sa lahat.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "E-Boses is a shared space for the whole barangay. A few simple rules keep it useful.",
              fil: "Ang E-Boses ay para sa buong barangay. May ilang simpleng patakaran para manatili itong kapaki-pakinabang.",
            },
          },
          {
            kind: "list",
            items: [
              {
                en: "Report only things you saw yourself, and describe them honestly.",
                fil: "Iulat lang ang inyong mismong nakita, at ilarawan ito nang totoo.",
              },
              {
                en: "Report the problem, not the person. Do not name or accuse a neighbour.",
                fil: "Iulat ang problema, hindi ang tao. Huwag pangalanan o paratangan ang kapitbahay.",
              },
              {
                en: "Use the emergency button only for a real emergency.",
                fil: "Gamitin lang ang emergency button para sa tunay na emergency.",
              },
              {
                en: "Keep comments respectful, even when you disagree.",
                fil: "Panatilihing magalang ang mga comment, kahit hindi kayo sang-ayon.",
              },
            ],
          },
        ],
      },
      {
        slug: "photos-of-other-people",
        title: {
          en: "Can I take photos of other people?",
          fil: "Puwede bang kuhanan ng litrato ang ibang tao?",
        },
        subtitle: {
          en: "Being fair to your neighbours when you attach a photo.",
          fil: "Pagiging patas sa kapitbahay kapag naglalakip ng litrato.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Photograph the problem, not the people around it. Stand back far enough that faces are not the subject, and never photograph inside someone's home or yard.",
              fil: "Kunan ng litrato ang problema, hindi ang mga taong nakapaligid. Lumayo nang sapat para hindi ang mukha ang paksa, at huwag kailanman kunan ang loob ng bahay o bakuran ng iba.",
            },
          },
          {
            kind: "note",
            body: {
              en: "The app blurs faces and vehicle plates before a photo is published, but that is a safety net, not a reason to take the photo in the first place.",
              fil: "Bino-blur ng app ang mga mukha at plaka bago ilathala ang litrato, pero panangga lang ito at hindi dahilan para kunan sila.",
            },
          },
        ],
      },
      {
        slug: "false-reports",
        title: {
          en: "What happens with false or repeated reports?",
          fil: "Ano ang nangyayari sa mali o paulit-ulit na report?",
        },
        subtitle: {
          en: "Why misuse affects the whole barangay.",
          fil: "Bakit nakakaapekto sa buong barangay ang maling paggamit.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "A false report sends people and equipment to the wrong place, which delays help for someone who truly needs it. Sending false emergency alerts or flooding the feed on purpose can get your account suspended.",
              fil: "Ang maling report ay nagpapadala ng tao at kagamitan sa maling lugar, kaya naaantala ang tulong sa tunay na nangangailangan. Maaaring suspindihin ang account ninyo kung sadyang magpapadala ng maling emergency alert o pupunuin ang feed.",
            },
          },
          {
            kind: "text",
            body: {
              en: "If you reported something by mistake, add a comment on it right away so the barangay knows.",
              fil: "Kung nagkamali kayo ng report, mag-comment agad dito para malaman ng barangay.",
            },
          },
        ],
      },
      {
        slug: "about-the-assistant",
        title: {
          en: "How should I use the E-Boses Assistant?",
          fil: "Paano dapat gamitin ang E-Boses Assistant?",
        },
        subtitle: {
          en: "What the chat assistant can and cannot do.",
          fil: "Ang kaya at hindi kaya ng chat assistant.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "The assistant answers questions about how to use the app. It cannot file a report for you, open your account, or see your personal information.",
              fil: "Sumasagot ang assistant sa mga tanong tungkol sa paggamit ng app. Hindi nito kayang mag-file ng report para sa inyo, buksan ang account ninyo, o makita ang inyong personal na impormasyon.",
            },
          },
          {
            kind: "note",
            body: {
              en: "The assistant can make mistakes. For anything urgent, use the emergency button or call the Marikina City hotline 161.",
              fil: "Puwedeng magkamali ang assistant. Para sa anumang agarang bagay, gamitin ang emergency button o tumawag sa Marikina City hotline 161.",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "troubleshooting",
    title: { en: "Troubleshooting", fil: "Pag-aayos ng problema" },
    description: {
      en: "Sign in problems, one time passwords, and common errors",
      fil: "Problema sa pag-sign in, one time password, at karaniwang error",
    },
    icon: WrenchIcon,
    articles: [
      {
        slug: "cannot-sign-in",
        title: { en: "I cannot sign in", fil: "Hindi ako makapag-sign in" },
        subtitle: { en: "What to check first.", fil: "Ano ang unang dapat tingnan." },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Confirm you are using the mobile number you registered with.",
                fil: "Tiyaking ginagamit ninyo ang cellphone number na ipinarehistro ninyo.",
              },
              {
                en: "Check that your account has been approved. A pending account cannot sign in yet.",
                fil: "Tingnan kung naaprubahan na ang account. Hindi pa makakapag-sign in ang pending na account.",
              },
              {
                en: "Use Forgot password to set a new password.",
                fil: "Gamitin ang Forgot password para gumawa ng bagong password.",
              },
            ],
          },
          {
            kind: "text",
            body: {
              en: "If none of these help, contact the barangay hall so staff can check the status of your account.",
              fil: "Kung wala pa rin, makipag-ugnayan sa barangay hall para matingnan ng tauhan ang status ng inyong account.",
            },
          },
        ],
      },
      {
        slug: "otp-not-arriving",
        title: {
          en: "My one time password is not arriving",
          fil: "Hindi dumarating ang aking one time password",
        },
        subtitle: {
          en: "When the code does not reach your phone.",
          fil: "Kapag hindi umaabot ang code sa inyong cellphone.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              {
                en: "Wait a full minute before requesting another code.",
                fil: "Maghintay ng isang minuto bago humiling ulit ng code.",
              },
              {
                en: "Check that your mobile number was entered correctly.",
                fil: "Tingnan kung tama ang pagkakalagay ng cellphone number.",
              },
              {
                en: "Move to a spot with better signal and request the code again.",
                fil: "Lumipat sa lugar na may mas malakas na signal at humiling ulit ng code.",
              },
            ],
          },
          {
            kind: "note",
            body: {
              en: "Codes can only be requested a few times in a row. If you reach the limit, wait a short while and try again.",
              fil: "May hangganan ang sunod-sunod na paghingi ng code. Kapag naabot ninyo ang limitasyon, maghintay sandali at subukan ulit.",
            },
          },
        ],
      },
      {
        slug: "photo-will-not-upload",
        title: { en: "My photo will not upload", fil: "Hindi ma-upload ang aking litrato" },
        subtitle: {
          en: "Attaching an image to a report.",
          fil: "Paglalakip ng litrato sa isang report.",
        },
        updated: AUG,
        blocks: [
          {
            kind: "list",
            items: [
              { en: "Use a JPEG or PNG image.", fil: "Gumamit ng JPEG o PNG na litrato." },
              {
                en: "Check that you have a working connection.",
                fil: "Tingnan kung maayos ang inyong koneksyon.",
              },
              {
                en: "Try a smaller photo if the upload keeps failing.",
                fil: "Subukan ang mas maliit na litrato kung paulit-ulit itong nabibigo.",
              },
            ],
          },
        ],
      },
      {
        slug: "contact-support",
        title: { en: "How do I contact support?", fil: "Paano makipag-ugnayan sa support?" },
        subtitle: { en: "Reaching the barangay directly.", fil: "Direktang pakikipag-ugnayan sa barangay." },
        updated: AUG,
        blocks: [
          {
            kind: "text",
            body: {
              en: "Visit the barangay hall at Marikina Heights, Marikina City during office hours, or call the Marikina City hotline 161 for urgent matters.",
              fil: "Bisitahin ang barangay hall sa Marikina Heights, Marikina City sa oras ng opisina, o tumawag sa Marikina City hotline 161 para sa mga agarang bagay.",
            },
          },
          {
            kind: "text",
            body: {
              en: "For questions about the app itself, use the E-Boses Assistant at the bottom right of this page.",
              fil: "Para sa mga tanong tungkol sa app, gamitin ang E-Boses Assistant sa kanang ibaba ng pahinang ito.",
            },
          },
        ],
      },
    ],
  },
]

export function findCollection(slug: string | undefined) {
  return HELP_COLLECTIONS.find((collection) => collection.slug === slug)
}

export function findArticle(slug: string | undefined) {
  for (const collection of HELP_COLLECTIONS) {
    const article = collection.articles.find((item) => item.slug === slug)
    if (article) return { collection, article }
  }
  return undefined
}
