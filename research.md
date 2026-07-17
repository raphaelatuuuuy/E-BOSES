  
**E-Boses: A Barangay Civic Engagement System with Integrated Emergency Coordination, Utilizing Computer Vision and NLP for Structured Community Feedback**

A Capstone Project    
Presented to the Faculty of the College of Computer and Information Sciences  
Polytechnic University of the Philippines  
Sta. Mesa, Manila

In Partial Fulfilment of the Requirements for the Degree  
Bachelor of Science in Information Technology

by

**Raphael Andrei G. Latoy**  
**Ma. Sierra Patrice H. Mendoza**  
**Lancilot Jannse S. Tibay**  
**Denisse M. Victoria**

**May 2026**

# **TABLE OF CONTENTS**

|  |  |  | Page |
| ----- | ----- | ----- | :---: |
| **Title Page** |  |  | 1 |
| **Table of Contents** |  |  | 2 |
| **List of Tables** |  |  | 4 |
| **List of Figures** |  |  | 5 |
|  **1 INTRODUCTION** |  |  |  |
| Project Context |  |  | 6 |
| Technical Background |  |  | 8 |
|  | Equipment/Hardware |  | 8 |
|  | Software |  | 9 |
|  | Peopleware/Manpower |  | 9 |
|  | Network Infrastructure/Architecture |  | 9 |
|  | Storage, Backup and Recovery Procedure |  | 10 |
|  | Security Procedures |  | 10 |
|  | Policies and Procedures |  | 11 |
| Problem Analysis |  |  | 14 |
|  | Fishbone Diagram |  | 14 |
|  | Problem and Solution Statement |  | 17 |
|  | Problem-Requirements Matrix |  | 20 |
| Purpose and Description |  |  | 22 |
| Specific Objectives |  |  | 25 |
| Scope and Limitations |  |  | 26 |
| Definition of Terms |  |  | 30 |
|  |  |  |  |
| **2 REVIEW OF LITERATURE, STUDIES, AND SYSTEMS** |  |  |  |
| Barangay Governance and Civic Engagement |  |  | 34 |
| Low Civic Participation and the Limits of the Barangay Assembly |  |  | 35 |
| Structured Digital Reporting in Local Governance |  |  | 36 |
| Computer Vision for Photo-Based Concern Reporting |  |  | 38 |
| Natural Language Processing for Filipino Community Feedback  |  |  | 39 |
| Emergency Response Coordination at the Barangay Level |  |  | 40 |
| Synthesis of the Study |  |  | 41 |
|  |  |  |  |
|  **3 METHODOLOGY** |  |  |  |
| Requirements Analysis |  |  | 44 |
|  | Requirements – Features Matrix |  | 46 |
|  | Use Case Diagram |  | 49 |
|  | Use Case Report |  | 54 |
| Design Specifications |  |  |  |
|  | Activity Diagram |  | 66 |
|  | Database Schema |  | 68 |
|  | Data Dictionary |  | 69 |
| Development Methodology |  |  |  |
|  | Process Model |  | 84 |
|  | Development Tools |  | 85 |
| Test Methodology/Procedures |  |  | 87 |
| System Requirements |  |  | 88 |
| Quality Plan |  |  | 89 |
| Implementation Plan |  |  | 94 |
| Evaluation Plan |  |  | 95 |
| Ethical Considerations |  |  | 96 |
| Data Analysis (Procedure and Treatment) |  |  | 97 |
| Statistical Treatments |  |  | 99 |
| **REFERENCES** |  |  | 102 |

**LIST OF TABLES**

|  Table No. |  Description |  Page  |
| :---: | ----- | :---: |
| 1 | Existing Equipment of Marikina Heights Barangay Hall | 8 |
| 2 | Problem-Requirements Matrix | 20 |
| 3 | Requirements-Features Matrix | 46 |
| 4 | User Login | 54 |
| 5 | Register Account | 56 |
| 6 | Submit a Community Concern | 57 |
| 7 | Review Submitted Concerns | 59 |
| 8 | Send Emergency Alert | 61 |
| 9 | Respond to Emergency Alert | 63 |
| 10 | Support a Community Concern | 64 |
| 11 | Manage System Settings | 65 |
| 12 | barangays (Data Dictionary) | 70 |
| 13 | users (Data Dictionary) | 71 |
| 14 | concern\_reports (Data Dictionary) | 73 |
| 15 | concern\_votes (Data Dictionary) | 76 |
| 16 | roles (Data Dictionary) | 76 |
| 17 | emergency\_alerts (Data Dictionary) | 77 |
| 18 | alert\_acknowledgements (Data Dictionary) | 79 |
| 19 | report\_status\_history (Data Dictionary) | 80 |
| 20 | system\_audit\_log (Data Dictionary) | 81 |
| 21 | witness\_notification (Data Dictionary) | 83 |
| 22 | Minimum and Recommended System Requirements | 89 |
| 23 | ISO 25010 Quality Model: Quality Characteristics of E-Boses | 89 |
| 24 | Likert Scale Interpretation | 100 |

**LIST OF FIGURES**

|  Figure No. |  Description |  Page  |
| :---: | ----- | :---: |
| 1 | Context Diagram of Current Barangay Process | 12 |
| 2 | Data Flow Diagram of Current Barangay Process | 13 |
| 3 | Fishbone Diagram of E-Boses Problem Analysis | 16 |
| 4 | General Use Case Diagram | 49 |
| 5 | Login Use Case Diagram | 49 |
| 6 | Register Use Case Diagram | 50 |
| 7 | Submit a Community Concern Use Case Diagram | 50 |
| 8 | Review Submitted Concerns Use Case Diagram | 51 |
| 9 | Send Emergency Alert Use Case Diagram | 51 |
| 10 | Respond to Emergency Alert Use Case Diagram | 52 |
| 11 | Support a Community Concern Use Case Diagram | 52 |
| 12 | Manage System Settings Use Case Diagram | 53 |
| 13 | Activity Diagram of Concern Reporting | 67 |
| 14 | Activity Diagram of Emergency Alert	 | 67 |
| 15 | Entity Relationship Diagram of E-Boses | 69 |

# **Chapter 1**

## **INTRODUCTION**

# **Project Context**

The barangay is the smallest yet most critical unit of local government in the Philippines. Under Republic Act No. 7160, also known as the Local Government Code of 1991, barangays are mandated to address community concerns, maintain public safety, and respond to emergencies within their jurisdiction. Despite this mandate, most barangays still operate without a centralized digital platform to collect, manage, and act on community concerns. Reports are typically submitted through walk-in visits to the barangay hall, phone calls placed to landline or mobile numbers maintained by the barangay, or handwritten entries in logbooks methods that are informal, inconsistent, and difficult to track.  
Emergency coordination presents an equally critical gap. Barangay *tanods* and barangay health workers serve as the nearest first responders in communities, yet residents currently have no structured digital channel to send emergency alerts directly to them, especially with location information. Lacanilao and Carpio (2025) highlight that communication gaps between residents and barangay response teams can significantly delay response times during urgent situations. The absence of GPS-tagged emergency reporting means that *tanods* often rely on informal calls or word of mouth, which reduces coordination effectiveness and may prolong harm to residents.  
This study was conducted with Barangay Marikina Heights in Marikina City, which reflects common challenges in local governance. Residents currently report concerns by visiting the barangay hall in person, while emergencies are communicated through a hotline. Complaints are recorded manually in logbooks without a proper tracking system, and there is no structured digital channel for residents to directly send emergency alerts to *tanods* or health workers.  
Technological advances in artificial intelligence, particularly computer vision and natural language processing (NLP), now offer practical solutions to these governance challenges. YOLO (You Only Look Once) is a state-of-the-art object detection model capable of analyzing images to identify and assess the severity of physical conditions in real time (Ultralytics, 2023). RoBERTa (Robustly Optimized BERT Pretraining Approach), and its Filipino-adapted counterpart developed by Cruz and Cheng (2021), enables accurate text analysis from text written in Filipino or Taglish, the mixed language predominant among Filipino residents, which will help to detect fake or irrelevant reports.  
To address these gaps, this study proposes E-Boses: A Barangay Civic Engagement System with Integrated Emergency Coordination, utilizing Computer Vision and NLP for Structured Community Feedback. E-Boses aims to provide barangay officials with an intelligent, data-driven platform that centralizes civic concern reporting and emergency alert coordination, making local governance more responsive, transparent, and accountable.  
E-Boses defines civic engagement as an active two-way process between residents and barangay officials. It goes beyond serving as a report repository because residents are able to submit concerns, receive updates, support existing community concerns, and contribute to the prioritization of issues through structured digital participation.  
While structured community feedback refers to resident concerns collected through standardized fields such as concern category, written description, uploaded photo, location, tracking number, validation status, and resolution updates. This makes every report complete, traceable, verifiable, and actionable compared to informal walk-ins, phone calls, logbooks, or social media posts.

# **Technical Background**

This section presents the current technical setup and operational practices of the target barangay or intended users. It examines the existing hardware, software, data, and processes used in daily operations. These findings serve as the basis for identifying both the functional and non-functional requirements of the proposed system, ensuring it fits the barangay’s current capabilities, meets user needs, and addresses existing limitations and inefficiencies

**Equipment/Hardware**

Table 1  
**Existing Equipment of Marikina Heights Barangay Hall**

| Equipment  | Quantity |
| :---: | :---: |
| Desktop Computers | 3 and above |
| Laptops | 3 and above |
| Two-way Radios | per staff member |
| Personal Smartphones | per staff member |
| Landline | 1 |

Table 1 presents the hardware resources currently available at the barangay hall. Based on the interview, barangay staff primarily use desktop computers for administrative tasks, while *tanods* rely on personal smartphones and two-way radios during patrols. The lack of barangay-issued mobile devices for *tanods* limits the adoption of GPS-enabled tools without a BYOD (Bring Your Own Device) approach integrated into the system design.

**Software**  
The barangay currently uses Microsoft Word and Excel for documentation and record-keeping. No dedicated complaint management or emergency response software is in place. No prior digital reporting system has been formally deployed or tested. This indicates a baseline readiness for a web-based or mobile system that does not require complex software migrations.

**Peopleware/Manpower**  
The barangay has only two formally hired personnel, the Secretary and the Treasurer. All other operational roles, including *tanods*, Barangay Disaster Risk Reduction and Management Office (BDRRMO) members, and Barangay Anti-Drug Abuse Council (BADAC) volunteers, serve in a volunteer capacity. Complaint handling is managed by department secretaries and the Barangay Captain, who personally chairs mediation hearings. Most staff are comfortable using smartphones and basic computer applications such as Microsoft Office. Training will be necessary for any new system, particularly for functions involving dashboards, report tracking, and alert management. The system interface shall consider elderly residents, PWDs, and users with limited technical ability by using simple labels, clear icons, readable text, and minimal steps for reporting concerns and sending emergency alerts.

**Network Infrastructure/Architecture**  
The barangay hall is connected to the internet through a fixed broadband subscription. Signal coverage varies across zones within the barangay, with some areas relying solely on mobile data. Residents predominantly access the internet via mobile data rather than WiFi. Since internet stability may be intermittent during emergencies, the system shall prioritize lightweight emergency alert transmission. SMS backup may be considered as a future contingency feature, subject to technical feasibility, barangay budget, and service-provider requirements.

**Security Procedures**  
Access to resident records is currently limited to the Barangay Secretary and the Barangay Captain. No formal authentication system governs access to digital files. Per consultation, the addition of personal information to a resident's record may only be made by the resident themselves, reflecting an informal but consistently practiced respect for personal data. The system shall protect personal information through OTP verification, role-based access control, encrypted transmission, consent-based data collection, privacy blurring, restricted raw media access, and audit logging. Uploaded media containing faces, license plates, injuries, or sensitive details shall be blurred or restricted from public view.

**Storage, Backup, and Recovery Procedure**  
Current complaint records are stored primarily in physical logbooks and filing cabinets, with supplementary digital files (Word documents and Excel spreadsheets) saved on local department computers. Records are retained for ten years before disposal, in accordance with standard barangay record-management practice. Physical records are housed in a designated warehouse storage area. No cloud backup system is in place, and no formal recovery procedure exists if a local file is lost. The proposed system will implement cloud-based storage with automated backups to ensure data persistence and availability.

**Policies and Procedures**  
When complaints are received at the barangay, they are written down by hand and set for mediation. The Barangay Captain leads up to three discussion sessions for each case. If the parties still cannot agree, the case is passed to the Lupong Tagapamayapa for up to three more sessions. If no agreement is reached and the complainant wants to continue, the barangay issues a Certificate to File Action, which allows the case to move to court. This process shows the barangay's role: to help people settle disagreements peacefully, not to act like a court.  
Emergency response works differently. When a call comes in, on-duty *tanods* or BDRRMO volunteers are sent right away to provide first aid or secure the area. If hospital transport or advanced medical help is needed, the barangay contacts the city hotline (161) to send medics. Right now, there is no standard digital way to track or escalate concerns that remain unresolved. The Department of the Interior and Local Government (DILG) requires barangays to keep complaint records and respond to concerns within a reasonable time but there is no digital system yet to support this. The proposed system will move these processes online while keeping the barangay's focus on peaceful resolution and following DILG rules on record-keeping and citizen services.

Figure 1 shows the current barangay operations process involving Residents, Barangay Staff, and Barangay Health Workers or Tanods. Residents personally visit the barangay office to report complaints or call the hotline during emergencies. Barangay Staff manually receive the complaint details and record them in physical logbooks, while emergency calls are forwarded to Barangay Health Workers or *Tanods* for response. Updates are usually given verbally or through face-to-face communication only when residents follow up or when responders arrive at the scene. The context diagram presents the existing manual process of handling reports, emergencies, and communication within the barangay.

**Figure 1\. Context Diagram of Current Barangay Process**

Figure 2 illustrates how information moves through the current barangay operations workflow across three actors: Residents, Barangay Staff, and Barangay Health Workers or Tanods. When a resident has a complaint, they walk into the barangay office and hand over the details verbally or on paper to Barangay Staff, who then manually write the entry into a physical logbook and store it as a complaint record. When an emergency occurs, the resident calls the hotline, triggering a separate process where the emergency details are processed and a dispatch order is sent to the nearest available Barangay Health Worker or Tanod. Once the responder acknowledges and acts on the dispatch, a response status is generated and the resident is notified, though this update is delivered only verbally or face-to-face, and only when the resident follows up or when the responder physically arrives on scene. The data flow diagram exposes the absence of any digital data store or automated feedback loop in the current process, with all information flows depending entirely on manual handling and informal communication.

**Figure 2\. Data Flow Diagram of Current Barangay Process**  
   
**Problem Analysis**  
This section presents a structured examination of the systemic challenges that E-Boses seeks to address. It employs the Fishbone Diagram to identify the root causes of fragmented civic reporting and emergency coordination at the barangay level, followed by the Problem and Solution Statement that defines the specific issues and proposes the technology-driven intervention, and concludes with the Problem–Requirements Matrix that aligns each identified problem with the corresponding system features to be developed.

**Fishbone Diagram**  
The Fishbone Diagram, also referred to as the Ishikawa or Cause-and-Effect Diagram, was used to systematically identify the root causes contributing to inefficient civic concern reporting and emergency coordination at the barangay level. The causes presented below are drawn directly from consultation with Barangay Marikina Heights officials and reflect observable, real-world conditions in current barangay operations rather than the absence of theoretical solutions. The causes are organized into four categories: Technology, People, Process, and Environment.

Under the **Technology category**, residents currently transmit concerns through three parallel channels, walk-in visits, phone calls placed to the barangay's landline, and unstructured digital messages  with no shared format that enables the barangay to consolidate or compare them. Barangay records are kept in physical cabinets and a designated warehouse storage area, with documents retained for ten years before scheduled disposal, making historical retrieval slow and discovery dependent on staff memory.   
Under the **People category** only two barangay personnel — the Secretary and the Treasurer are formally hired; *tanods*, BDRRMO members, and other responders serve as volunteers, which makes scheduling and continuity of duty dependent on availability. First responders coordinate over phone calls and two-way radios without a shared digital incident log, so situational awareness depends on whoever is on the line at the moment. Elderly residents and persons with disabilities depend on walk-in visits or phone calls placed by relatives, while working residents who cannot attend assemblies or visit the hall during office hours have no asynchronous reporting channel. Arrabaca and Base (2020) similarly documented chronically low barangay assembly attendance, and Lacanilao and Carpio (2025) confirmed that coordination and communication deficiencies hinder the field effectiveness of barangay *tanods*.  
Under the **Process category**, complaints are first written down in logbooks before being set for mediation. Cases go through several discussion sessions first with the Barangay Captain, and if needed, up to three more sessions with the Lupong Tagapamayapa before a Certificate to File Action can be issued. Concerns that the barangay cannot handle (like stray animals) are passed by phone to the right City Hall office, but follow-up depends on when that office responds. Emergency help starts only after a call is received and confirmed by the on-duty *tanod* or BDRRMO volunteer. Updates on complaints are shared only when residents visit the hall or call again. Salanga et al. (2023) also found that the lack of a clear, organized way for residents and responders to communicate is the biggest challenge in barangay emergency response.

Finally, under the **Environment category**, barangay concerns can only be received during office hours, leaving incidents that occur at night, on weekends, or on holidays without any formal documentation channel until the next working day. Residents living far from the barangay hall must travel in person to file or follow up on complaints, particularly for issues requiring documentation. Non-barangay concerns experience added delay because they require referral and coordination with external city offices. Documentation of recurring community issues exists only in scattered logbook entries that are eventually disposed of after the ten-year retention period, leaving no longitudinal record from which trends could be analyzed.  
Taken together, these four categories converge on a single effect: delayed and inefficient handling of civic concerns and emergency incidents in barangays. Figure 3 presents the complete Fishbone Diagram.

**Figure 3\. Fishbone Diagram of E-Boses Problem Analysis**

**Problem and Solution Statement**

The absence of a centralized digital platform for civic engagement and emergency coordination at the barangay level represents one of the most persistent governance gaps in Philippine local government. Under Republic Act No. 7160, also known as the Local Government Code of 1991, barangays are legally mandated to address community concerns and implement responsive service delivery (Republic of the Philippines, 1991). Despite this mandate, most barangays continue to operate without structured systems for receiving, analyzing, and acting on resident reports. Civic participation at Barangay Marikina Heights remains fragmented across walk-in visits, phone calls to the landline, and manual logbook entries, none of which provide standardized documentation, official tracking, prioritization, or resolution accountability (Schiff, 2023).  
This fragmentation produces measurable governance failures. Reports are duplicated or entirely lost. Residents who submit concerns have no mechanism to verify whether their submission was received or resolved. Barangay officials, lacking objective data about community concerns, are forced to rely on informal impressions and political considerations when allocating attention and resources. Brillantes and Moscare identified this persistent absence of structured community feedback mechanisms as the primary barrier to effective barangay-level participatory governance in the Philippines, a finding that remains fully applicable today.

The problem is compounded by the exclusion of vulnerable populations. Arrabaca and Base (2020) documented that barangay assembly attendance across multiple years consistently fell far below the threshold required for genuine participatory governance. López-Moctezuma et al. (2022) measured that meeting attendance averages only five percent of registered voters and drops to as low as half a percent in densely populated barangays. Working adults, elderly residents, persons with disabilities, and those living in geographically peripheral areas are effectively unable to participate in formal governance channels, not by choice, but by structural exclusion.  
Emergency response coordination represents a second and equally urgent governance gap. Barangay *tanods* and barangay health workers are legally recognized as the community's closest first responders, yet they currently lack a structured digital channel through which residents can transmit emergency alerts directly to them with GPS location data attached. As Lacanilao and Carpio (2025) confirmed, coordination and communication gaps significantly hinder *tanod* effectiveness across crimes, disasters, and medical incidents. Salanga et al. (2023) identified the absence of a structured resident-to-responder relay system as the single most critical difficulty in barangay emergency response, forcing residents to call disconnected hotlines, shout for help, or depend on whoever happens to be physically nearby.

**Problem Statement**  
The reliance on dispersed and informal reporting methods: walk-ins, phone calls, and handwritten logbooks at the barangay level produces no official documentation, no tracking of resolution, and no objective data for governance decision-making. Concurrently, the absence of a structured digital emergency coordination channel forces residents to use fragmented means to reach barangay first responders during crises, resulting in delayed response and uncoordinated community action. These twin gaps systematically exclude vulnerable populations from civic participation, prevent transparent and evidence-based governance at the barangay level, and leave emergency response dependent on informal communication rather than structured coordination.   
To address these interconnected governance failures, E-Boses proposes a centralized, web-based, mobile-responsive barangay civic engagement platform that integrates structured concern reporting with AI-assisted analysis and GPS-tagged emergency coordination.  
**Solution Statement**  
 E-Boses will be developed as a centralized barangay civic engagement platform with two core modules. The system separates normal civic concerns from emergency reports. Normal concerns follow the process of submission, automatic validation, classification, prioritization, barangay review, action, and feedback. Emergency alerts follow a faster route: emergency button activation, confirmation, automatic validation, emergency classification, responder routing, response update, and resolution logging.  
Residents can view their submitted reports, tracking numbers, and status updates. Barangay officials can view validated reports, AI-generated scores, location data, uploaded evidence, prioritization results, and action history. Responders can only view emergency alerts assigned to their role.  
The Civic Concern Reporting Module will enable verified residents (validated though submitted IDs using OCR) to submit photo-documented concerns with GPS location and written descriptions, with YOLOv8 Computer Vision automatically analyzing the submitted photo to score damage severity and the jcblaise/roberta-tagalog-base NLP model analyzing the written description to filter out fake or irrelevant reports, producing a producing an evidence-based concern assessment with an official tracking number and enabling residents to monitor resolution status. The Emergency Alert Module will enable residents to send GPS-tagged emergency notifications directly to appropriate responders, while simultaneously notifying residents within a designated radius to assist while official responders are in transit. By structuring civic participation and emergency communication into a single platform with AI-assisted prioritization, E-Boses transforms fragmented and informal community interaction into a transparent, evidence-based, and responsive governance system.

**Problem-Requirements Matrix**  
The Problem–Requirements Matrix presented in Table 2 aligns each identified problem with the specific system requirements developed for E-Boses to address it. This alignment ensures that no major problem is left unaddressed, that all system requirements are traceable to documented governance failures, and that development remains goal-oriented and requirements-driven. The matrix also serves as a reference during testing and evaluation to verify that implemented features produce the intended outcomes.

Table 2  
**Problem-Requirements Matrix**

| Problem | Requirements |
| ----- | ----- |
|  Residents rely on Facebook posts, verbal complaints, and handwritten logs to report community concerns, producing no official documentation, no tracking number, and no resolution accountability | The system shall provide a Civic Concern Reporting Module where verified barangay residents can submit photo-documented concerns with written descriptions and GPS location, generating an official tracking number and enabling residents to monitor resolution status. |
|  Barangay officials lack objective data for prioritizing concerns because current informal reports contain no standardized severity assessments.  |  The system shall integrate YOLOv8 Computer Vision to automatically score damage severity from submitted photos producing an AI-assisted concern assessment to guide official prioritization. |
|  Vulnerable populations like elderly residents, persons with disabilities, working adults, and geographically remote residents are excluded from civic participation due to structural barriers |  The system shall function as a web-based, mobile-responsive platform accessible across mobile and desktop browsers without requiring native app installation, enabling participation without physical assembly attendance. |
|  Residents have no structured digital channel to send emergency alerts directly to barangay *tanods* and health workers with precise location data attached | The system shall implement an Emergency Alert Module that enables residents to send GPS-tagged emergency notifications directly to barangay first responders for immediate routing and incident categorization. |
|  Community witnesses near an emergency incident are not notified to assist, leaving official responders without community support during transit. |  The system shall trigger community witness notifications to verified residents within a designated radius from the emergency alert location, enabling nearby residents to assist while official responders are in transit. |
| The system may receive fake users, fake reports, fake GPS data, duplicate reports, manipulated media, or AI-generated uploads. | The system shall automatically validate user identity, report content using NLP, uploaded media, and location data before accepting reports or triggering actions. |
| Emergency reports may be delayed if treated the same as normal concerns. | The system shall separate normal concern reporting from emergency alert handling and route valid emergency alerts immediately after automatic validation. |
| Uploaded photos or videos may contain faces, license plates, injuries, or other personally identifiable information. | The system shall protect sensitive media through privacy blurring, restricted access, consent notices, and role-based access control. |
| Senior citizens and users with limited technical ability may experience difficulty sending emergency alerts. | The system shall provide a large, simple, senior-friendly emergency button and may consider SMS backup for no-internet situations. |
| Records are stored in physical cabinets and warehouse storage with no cross-department index, making historical retrieval slow and dependent on staff memory. | The system shall maintain a centralized, cloud-based digital record of all submitted concerns and alerts with role-based access and automated daily backups. |

**Purpose and Description**  
*E-Boses: A Barangay Civic Engagement System with Integrated Emergency Coordination, Utilizing Computer Vision and NLP for Structured Community Feedback* is developed to address a fundamental and persistent gap in Philippine local governance: the absence of a structured, technology-mediated platform that enables barangay residents to formally participate in civic reporting and emergency coordination. The system exists to transform fragmented, informal, and unaccountable community communication into a structured, data-driven, and responsive governance process at the most immediate level of Philippine government.  
The purpose of E-Boses is twofold. First, it aims to provide barangay residents with a formal, accessible, and structured channel to submit civic concerns, supported by photographic evidence and geographic data, and receive official tracking and resolution accountability for those submissions. The system addresses the documented failure of informal platforms such as Facebook groups, which allow unstructured posts but provide no official documentation, no assignment to responsible officials, and no mechanism for tracking whether reported concerns are ever resolved (Schiff, 2023). By formalizing civic reporting, E-Boses converts what are currently individual and ignored complaints into structured, accountable governance inputs.  
Second, E-Boses aims to provide a direct and structured digital emergency coordination channel between barangay residents and their designated first responders: barangay *tanods* and barangay health workers. The absence of such a channel has been identified as the most critical operational barrier to effective barangay emergency response (Salanga et al., 2023), forcing residents to rely on disconnected hotlines, social media, or proximity-dependent informal communication during emergencies. E-Boses addresses this gap by enabling GPS-tagged emergency alerts transmitted directly to appropriate barangay responders, paired with community witness notifications to mobilize nearby residents while official responders are in transit (Lacanilao & Carpio, 2025).  
The platform is designed to serve four user groups: verified barangay residents, barangay officials (Barangay Captain and Kagawads), first responders (*Tanods* and Barangay Health Workers), and system administrators. The system supports four levels of engagement. The first level is Reporting, where residents submit concerns or emergency alerts. The second level is Informed, where residents receive tracking numbers and status updates. The third level is Feedback, where residents may support or upvote existing concerns. The fourth level is Co-decision Support, where AI-generated scores and community votes assist barangay officials in prioritizing concerns while final decisions remain with authorized personnel.  
The intelligent core of E-Boses consists of two AI components working in concert. YOLOv8, a free, open-source real-time object detection model validated across multiple civic concern categories including road damage (Saluky et al., 2023; Huang et al., 2024), illegal dumping (Zhou et al., 2024), flooding (Qiu et al., 2025), and stray animals (Rao et al., 2025), analyzes submitted photos to produce an objective damage severity score. Simultaneously, the jcblaise/roberta-tagalog-base NLP model, established by Cruz and Cheng (2022) as the most accurate baseline for Filipino text classification and validated for Taglish text by Cosme and De Leon (2024). The researchers will fine-tune the model using a locally collected barangay complaints dataset to analyze resident descriptions and detect fake or irrelevant reports. The combined outputs of Computer Vision and NLP provide an evidence-based concern assessment by validating submitted reports, detecting potentially irrelevant content, and identifying the severity of visible community issues.  
Emergency alerts bypass severity-based prioritization and are immediately routed to the appropriate responder after validation. Severity scoring is applied only to normal civic concerns for dashboard prioritization purposes.  
E-Boses is implemented as a web-based, mobile-responsive application to ensure cross-platform accessibility without requiring residents to download native applications. The platform employs OTP-based identity verification to restrict participation to verified barangay residents, preventing the unverified access that undermines the civic accountability of informal platforms such as Facebook groups. This design ensures that concern reports and emergency alerts are traceable to verified community members, strengthening the credibility and accountability of all platform interactions.  
The system is grounded in the legal framework established by Republic Act No. 7160, the Local Government Code of 1991, which mandates barangays to address community concerns and implement responsive, participatory governance (Republic of the Philippines, 1991). It further aligns with the DILG Barangay Governance Performance Management System (BGPMS), which evaluates barangays on citizen participation, transparency, and accountability in service delivery. By generating structured civic data and maintaining a documented resolution record, E-Boses directly supports a barangay's compliance with BGPMS performance criteria and provides verifiable evidence for DILG field evaluations.  
In summary, E-Boses is a civic technology solution designed to digitize and structure the two most fundamental governance interactions at the barangay level: the submission of community concerns and the coordination of emergency response. Through its AI-assisted concern assessment, structured emergency alert system, and accessible web-based design, the platform bridges the long-standing gap between the participatory governance mandate of Philippine law and the fragmented, informal reality of how most barangays currently operate.

**Specific Objectives**

1. To design, develop, and implement a centralized civic engagement platform within the project timeline that enables verified barangay residents to submit community concerns with photo documentation, written descriptions, and GPS location data, while generating unique reference numbers and allowing submitted concerns to be tracked from submission to resolution.  
2. To integrate AI-based analysis modules by fine-tuning a Tagalog RoBERTa NLP model on locally collected barangay complaint data and by using YOLOv8 for image-based concern verification and severity scoring, enabling the system to detect fake or irrelevant reports, and support evidence-based prioritization.  
3. To develop and validate a web based, mobile responsive platform within the system development and testing phases that requires no native installation and allows test users to successfully access, submit reports, and monitor concerns using standard mobile and desktop browsers.  
4. To develop and test an emergency alert module that allows residents to send GPS-tagged emergency reports, automatically validates submitted user, location, and media data, classifies emergency type through NLP, and routes valid alerts to BHW, BDRRMO, or barangay *tanod*.  
5. To evaluate the system's quality and acceptability by assessing functionality, usability, performance efficiency, and user satisfaction based on feedback from selected test users.

**Scope and Limitations**  
This study covers the design, development, and evaluation of E-Boses, a web-based, mobile-responsive barangay civic engagement and emergency coordination system. The system is intended for use by verified residents, barangay officials, and authorized personnel within the selected barangay.  
The system includes automatic validation and protection mechanisms for user identity, report content, location data, and uploaded media. User identity is verified through OTP, ID authenticity checking, duplicate account checking, and OCR. Report content is checked using NLP-based relevance and fake-report detection. Location data is validated through GPS accuracy, barangay boundary checking, and manual map pinning when GPS is unavailable. Should there be any internet or power outages, possible implementation of SMS backup may be considered subject to the feasibility requirements. Uploaded IDs, photos, and videos are checked for authenticity, editing, manipulation, duplication, AI-generation, and file quality.

The scope of the system includes the following functionalities:

* Civic Concern Reporting: Residents can submit community concerns with photo documentation, written descriptions, and GPS location data through a centralized platform.  
* Tracking and Monitoring: Each submitted report is assigned a unique reference number, allowing users to track the status and resolution of their concerns.  
* AI-Assisted Analysis: Integration of computer vision (YOLOv8) for severity detection from images and NLP for fake reports or irrelevant textual descriptions.  
* Emergency Alert Module: Residents can send GPS-tagged emergency alerts through an emergency button directly to barangay *tanods* and health workers for immediate response.  
* Community Notification Feature: Verified residents within a defined radius receive notifications to assist during emergencies while responders are en route.  
* User Access and Interface: The system is accessible via standard mobile and desktop web browsers without requiring native application installation.  
* Administrative Dashboard: Barangay officials can manage reports, view AI-generated assessments, monitor response progress, and coordinate emergency actions.

The system will be tested using selected users from the target barangay to evaluate functionality, usability, and performance.

Despite its intended capabilities, the study is subject to the following limitations:

* Scope Restriction: The system is limited to barangay-level civic engagement and decision-support functionalities and does not extend to external government systems or private service providers.  
* No External System Integration: The project excludes API integration with utility providers, national government databases, and emergency hotlines due to the need for regulatory approvals, infrastructure coordination, and inter-agency agreements beyond the barangay’s capacity.  
* No Full Automation of Decisions: The system does not automate governance decisions. Barangay officials are required to review AI-generated recommendations, apply local knowledge, and make final decisions regarding concern prioritization and emergency response.  
* Exclusion of Other Barangay Functions: The system does not replace or include other administrative processes such as Barangay Assembly proceedings, civil registration, payroll systems, utility service management, or blotter record handling.  
* Dependence on Data Quality: The accuracy of Computer Vision and NLP analysis depends on the quality and completeness of user-submitted data. Poor images or vague descriptions may reduce the reliability of system-generated assessments.  
* Need for Human Oversight: The system requires continuous supervision by barangay officials to interpret outputs, validate reports, and ensure appropriate actions are taken. AI components are intended to assist, not replace, human judgment and accountability.

**Definition of Terms**

* **Barangay** \- The smallest administrative division in the Philippines, similar to a village, district, or neighborhood. It is led by a Barangay Captain and is responsible for local services, safety, and resolving community issues.  
* **BDRRMO** \- The barangay's disaster response team, similar to a local emergency unit. It is led by a Barangay Disaster Coordinator and is responsible for preparing for, responding to, and recovering from emergencies like floods, fires, and typhoons, including first aid, evacuation, and coordinating with city rescue teams.  
* **BADAC** \- The barangay's anti-drug abuse council, similar to a community safety committee. It is led by the Barangay Captain and is responsible for preventing drug-related issues through awareness programs, monitoring at-risk individuals, and coordinating with police and city health offices for support and rehabilitation.  
* **Computer Vision** \- A type of artificial intelligence (AI) that allows computers to "see" and understand the content of images or photos, such as identifying a broken road or flooded area from a picture.  
* **Civic Engagement** — Active participation of residents in barangay governance through reporting concerns, receiving updates, providing feedback, supporting community issues, and contributing to prioritization.  
* **Structured Community Feedback** — Resident-submitted concerns collected through standardized fields such as category, description, photo, location, tracking number, status, and validation result.  
* **Severity Level** — A rating from 1 to 5 used to classify the seriousness of a normal concern (excluding emergencies), where 1–2 means low, 3 means medium, 4 means high, and 5 means critical.  
* **Personally Identifiable Information (PII)** — Any information that may identify a person, including name, address, contact details, face, license plate, exact location, or other sensitive data.  
* **Media Authenticity Check** — The process of checking whether an uploaded ID, photo, or video is edited, manipulated, duplicated, AI-generated, unreadable, or suspicious.  
* **Natural Language Processing (NLP)** \-  A type of artificial intelligence that helps computers understand, interpret, and analyze human language (words and sentences), such as determining if a complaint sounds fake or not.  
* **GPS (Global Positioning System)** \- A satellite-based system that determines the exact location of a device (like a smartphone). In this system, it allows residents to send their exact location when reporting an emergency.  
* **Fishbone Diagram (Ishikawa or Cause-and-Effect Diagram)** \-  A visual tool used to identify all possible root causes of a problem. It looks like a fish skeleton, with the main problem at the head and causes branching out like bones.  
* **Escalation Procedure** \- A step-by-step process for moving an unresolved complaint to a higher authority (e.g., from a barangay kagawad to the barangay captain, or from the barangay to the city hall) when it cannot be solved at the current level.  
* **Role-Based Access Control (RBAC)** \- A security system that limits what information a user can see or do based on their role. For example, a barangay captain can see all reports, but a resident can only see their own.  
* **HTTPS / TLS (Transport Layer Security)** \- Technologies that encrypt (scramble) data sent between a user's browser and the system's server. This prevents hackers from reading sensitive information like addresses or photos during transmission.  
* **Cloud-Based Storage** \- Storing data on remote servers managed by a provider (e.g., Google Drive, AWS) instead of saving files only on a single computer at the barangay hall. It allows automated backups and access even if one device fails.  
* **Automated Backup** \- The system automatically creates a copy of all data at scheduled times without manual effort. If the original data is lost, the backup copy can be restored.  
* **Data Persistence** \- The ability of data to remain available and unchanged even after the system is shut down or restarted. It ensures that submitted reports are not lost.  
* **GPS-Tagged Emergency Notification** \- An emergency alert that automatically includes the exact latitude and longitude (location coordinates) of the person sending it, so responders know exactly where to go.  
* **Offline Queuing** \- A feature that stores an emergency alert or report on the user's phone when there is no internet connection. Once the connection returns, the system automatically sends all stored data.  
* **Native Application** \- A software app that must be downloaded and installed from an official store (e.g., Google Play Store or Apple App Store) onto a smartphone. E-Boses does NOT require this.  
* **Administrative Dashboard** \- A screen or control panel visible only to barangay officials that shows all incoming reports, AI-generated scores, pending tasks, map of alerts, and resolution statuses in one place.  
* **Geographic Exclusion** \- A situation where residents living in remote, far, or hard-to-reach areas of the barangay cannot participate in governance (e.g., attend assemblies or submit reports) simply because of where they live.  
* **Baseline Readiness** \- A measurement of how prepared a barangay is to adopt a new technology, based on their existing hardware (computers), software (Excel, Word), and staff skills. Barangay Marikina Heights has basic readiness.  
* **BYOD Integration** \- Designing the system to work well on personal smartphones because the barangay does not issue official devices to *tanods* or health workers.  
* **Data Redundancy** \- Storing the same data in multiple places (e.g., cloud \+ local backup) to prevent complete loss if one storage location fails.

# 

# **Chapter 2**

**REVIEW OF LITERATURE, STUDIES, AND SYSTEMS**

**Barangay Governance and Civic Engagement**  
The barangay, as the smallest unit of government in the Philippines, is responsible for addressing the everyday concerns of its residents, yet many continue to struggle with weak leadership, limited resources, and poor citizen involvement. Malajos (2024) reviewed existing research on how Barangay Captains govern and found that the most common problems are lack of training, political pressure, and limited funds. The study noted that barangays where residents are actively involved tend to perform better in delivering services and earning public trust.  
Similarly, Zabala (2024) studied barangays in Zamboanga City and found that poor coordination between offices and low resident involvement in decision-making remain persistent barriers, pointing to digital tools as one of the most practical ways to improve communication between residents and local officials. Paranga Jr. et al. (2025) further found that resident participation in community projects was the weakest area of governance in Barangay Silangan I, Rosario, Cavite, and that barangays where officials are more transparent and responsive tend to achieve better outcomes.  
Bacasmas (2025) reinforced these findings by comparing barangays in Lamitan City and finding that those which used technology in their services had a 43% improvement in satisfaction and a 38% increase in community trust, with urban barangays scoring 78% in effectiveness compared to only 52% for rural ones. Taken together, these studies confirm that the absence of a structured digital platform for community feedback is not an isolated problem but a systemic one across Philippine barangays, which is the exact gap E-Boses is designed to fill.

For this study, civic engagement is treated as a structured and continuous form of participation rather than a one-time act of filing a complaint. It includes resident reporting, access to status updates, feedback through community support features, and participation in prioritization through aggregated community input. This supports the need for E-Boses to function not merely as a complaint repository but as an engagement platform for resident–barangay interaction.

**Low Civic Participation and the Limits of the Barangay Assembly**  
The Barangay Assembly is the main formal event where residents are supposed to voice their concerns and participate in local decisions, but in practice, attendance remains critically low. Arrabaca and Base (2020) documented that assembly attendance consistently fell far below the level needed for genuine participatory governance across multiple years, recommending that LGUs intensify efforts to encourage regular citizen engagement.  
López-Moctezuma et al. (2022), published in the American Journal of Political Science, further measured that barangay meeting attendance averages only 5% of registered voters and drops to as low as 0.5% in densely populated barangays, confirming that the assembly alone cannot serve as the primary channel for participatory governance. Yusingco (2022) explained that this low turnout is partly because assemblies are dominated by political groups with little interest in genuine dialogue, causing many residents to feel that attendance leads to no real change.  
Doromal et al. (2018) similarly found that most barangays in Tangub City showed only moderate civic engagement and that formal structures are needed to sustain participation since people do not engage consistently on their own. Lacay et al. (2025) added that even though residents in Barangay San Jose, San Antonio, Quezon regularly use smartphones and the internet, they are rarely updated on what is happening in their barangay and strongly agreed that a digital platform is essential for transparency and meaningful participation.  
These studies collectively show that low assembly attendance reflects a structural gap, residents have no practical, reliable, and always-available channel to engage with their barangay outside of physical gatherings which the project directly addresses by providing a digital platform that works anytime and on any smartphone.

**Structured Digital Reporting in Local Governance**  
Research confirms that structured digital concern reporting significantly improves how governments respond to residents and how much residents trust their local officials. Schiff (2023), in Public Administration Review, found that digital civic reporting platforms improve government response times and increase citizen satisfaction, but also documented a geographic equity gap where wealthier neighborhoods received faster responses than lower-income areas. This finding directly motivates the AI-based severity in the project, which ranks concerns based on objective data from submitted photos and text rather than on the location or social standing of the reporter.  
Existing platforms highlight the limitations of current approaches. Facebook groups, which are the most widely used civic communication tool at the barangay level, are entirely unstructured, have no identity verification, no official record numbers, no status tracking, and no way to aggregate related reports, all of which Schiff (2023) identified as drivers of duplicate unresolved concerns and reduced public trust. SeeClickFix, the closest international equivalent to E-Boses' reporting module, allows residents to report infrastructure problems and track responses but has no verified barangay-only access, no Filipino or Taglish NLP support, and no emergency coordination capability.  
Philippine-specific systems such as BarangayConnect, BARS, and Barangay360 focus exclusively on administrative records management such as blotter records, clearances, and civil registration \- leaving residents as passive recipients with no active reporting role. eGovPH operates at the national level and includes a conversational AI assistant for navigating government services, but does not include AI-based damage scoring, GPS-tagged photo reporting, or community-level concern prioritization (DICT, 2024). MyNaga, the official app of the City Government of Naga, provides access to city services and information but does not include NLP analysis or GPS-tagged emergency alerting at the barangay level. These gaps in existing systems show that no single platform fully integrates key features for reporting, analysis, and coordination at the barangay level.  
Structured digital reporting requires verification, standardization, and traceability. In E-Boses, each report must contain a category, description, location, evidence, and tracking record. This design addresses the weaknesses of informal reporting channels where reports may be duplicated, incomplete, unverifiable, or unresolved due to the absence of official tracking and accountability mechanisms.  
The system must also address risks associated with fake users, fake locations, duplicate reports, and manipulated media. Therefore, identity verification, GPS validation, report hashing, image checks, and manual review of uncertain cases are necessary safeguards for maintaining reliable digital barangay records.

**Computer Vision for Photo-Based Concern Reporting**  
A key feature of E-Boses is that residents can attach a photo when submitting a concern, and the system uses YOLOv8 to analyze that photo and score the severity of what is visible. YOLOv8 is a free and open-source real-time object detection model developed by Ultralytics, pre-trained on the COCO dataset which covers 80 common object classes, and supports custom fine-tuning on locally collected imagery for higher precision on infrastructure-specific categories.  
Multiple studies validate its accuracy across the specific concern categories covered in E-Boses. Saluky et al. (2023), published in IEEE, evaluated YOLOv8 for urban road pothole detection and found it achieved a mean average precision of 91% at the 0.5 IoU threshold, directly validating its use for the road damage concern category. Huang et al. (2024), published in Scientific Reports, confirmed high accuracy on road defect detection using the RDD2022 dataset, which can be adapted for Philippine road conditions at no cost.  
Zhou et al. (2024), published in AIP Advances, demonstrated that YOLOv8 achieves 90% recognition accuracy across 44 garbage categories in a 15,000-image dataset, validating its use for the illegal dumping concern category. Qiu et al. (2025), published in Natural Hazards and Earth System Sciences, confirmed that YOLOv8 reliably identifies urban flood inundation levels from images of flooded streets and vehicles, supporting flood severity scoring from citizen-submitted photos. Rao et al. (2025) developed a YOLOv8-based stray animal supervision model and demonstrated a mean average precision of 0.767 with an F1 score of 0.75 for stray dog detection in community environments, validating its use for the stray and biting animal concern category.  
Together, these studies confirm that YOLOv8 is technically validated across the most common civic concern categories in E-Boses, while its pre-trained COCO weights cover remaining categories such as vandalism, broken streetlights, and public health hazards without requiring additional training data.  
In this study, YOLOv8 is not used to make final barangay decisions. Its role is to assist in identifying visible objects or conditions in submitted photos and to generate a severity score for normal civic concerns. The severity score supports prioritization but remains subject to review or override by authorized barangay officials.  
Uploaded media require authenticity checks. The system may inspect metadata, compare image hashes for duplicates, flag low-confidence or suspicious media, and subject questionable files for rejection. These measures reduce the risk of copied, edited, or irrelevant images being used as evidence for barangay action.

**Natural Language Processing for Filipino Community Feedback**   
Cruz and Cheng (2022) established the jcblaise/roberta-tagalog-base model as the most accurate baseline for Filipino text classification, consistently outperforming all previously existing Filipino language models. Unlike general English models, it processes Filipino and Taglish expressions, which is how most barangay residents naturally write when describing concerns.  
Visperas et al. (2023) validated the feasibility of applying transformer-based NLP to Philippine languages by introducing the iTANONG-DS benchmark dataset for downstream NLP tasks. Cosme and De Leon (2024) confirmed that transformer-based models achieve high accuracy in understanding mixed Filipino-English text using the FiReCS corpus.  
The Tagalog RoBERTa model will be fine-tuned using locally collected or validated barangay complaint data to improve its relevance to actual community language, including Filipino and Taglish expressions. The NLP module will help to detect irrelevant or suspicious content.

**Emergency Response Coordination at the Barangay Level**  
Barangay *Tanods* and health workers serve as the nearest first responders in most communities, yet coordination and communication gaps significantly limit their response effectiveness. Lacanilao and Carpio (2025) confirmed that *tanods* actively respond to crimes, medical incidents, and disasters but are held back by the absence of structured communication tools. Salanga et al. (2023) identified that the most critical difficulty in barangay emergency response is the lack of a system for residents to relay reports to the right responder quickly, with residents currently relying on phone calls, Facebook posts, or word-of-mouth that introduce delays and confusion.  
A GPS-based alert system removes ambiguity about incident location and gets response teams moving faster. Nearby residents can also be notified to assist while the team is on the way, reflecting the concept of bayanihan the Filipino practice of neighbors helping each other which Yusingco (2022) identified as a core value already embedded in Filipino community life that can be given a faster and more organized digital structure.

Emergency coordination must prioritize speed, accessibility, and role-specific routing. A senior-friendly emergency interface should use a large button, simple labels, recognizable icons, and minimal steps before sending an alert. Furthermore, through role based access control (RBAC) to route it to proper responders. Since internet access may become unstable during emergencies, SMS backup may be considered as a contingency feature to support emergency reporting when mobile data or WiFi is unavailable.  
**Synthesis of the Study**  
The literature and studies reviewed consistently point to two connected and systemic problems in barangay governance: residents have no reliable digital channel to report concerns in a structured way, and there is no organized system for coordinating emergency response at the community level. These gaps appear across different cities, provinces, and types of barangays, from Zamboanga City (Zabala, 2024), to Cavite (Paranga Jr. et al., 2025), and Quezon (Lacay et al., 2025), confirming that these issues are not isolated but widespread.   
Research also consistently shows that residents are digitally ready and willing to use a platform like E-Boses. Structured digital channels are shown to improve satisfaction and trust in local government (Bacasmas, 2025), and residents themselves strongly support the creation of a barangay digital platform (Lacay et al., 2025). This supports the need for a system that does not only collect reports but also promotes active civic engagement through reporting, status updates, resident feedback, community support, and data-assisted prioritization.  
The AI components of the system—YOLOv8 for photo analysis and RoBERTa for text analysis—fill a gap that no existing barangay platform has addressed: turning informal photo-and-text submissions written in Filipino or Taglish into structured, prioritized, and trackable concern reports. In this study, YOLOv8 supports image-based verification and severity scoring, while the Tagalog RoBERTa NLP model supports fake or irrelevant report detection. The NLP model shall be fine-tuned using locally collected or validated barangay complaint data to improve its relevance to actual community reporting patterns.   
The reviewed literature also supports the need for validation mechanisms in digital civic reporting. Since unstructured platforms may allow fake users, duplicate reports, fake locations, irrelevant content, or manipulated media, E-Boses must validate user identity, report content, uploaded media, and location data before accepting reports or triggering actions. These safeguards include OTP and ID verification, NLP-based relevance checking, GPS accuracy and barangay boundary validation, manual map pinning when GPS is unavailable, duplicate text or image detection, and media authenticity review.   
Emergency coordination must also be treated as a separate and faster process from normal concern reporting. Normal concerns require validation, classification, prioritization, barangay review, action, and feedback, while emergency alerts must be validated and immediately routed to the correct responder role. Through NLP-based classification, medical alerts may be routed to Barangay Health Workers, fire and disaster alerts to BDRRMO, and crime-related alerts to barangay *tanods*. Role-Based Access Control must ensure that each responder can only view and act on emergency alerts assigned to their role.   
The literature further supports privacy protection and accessibility as essential system requirements. Since residents may upload photos, videos, location data, and other personally identifiable information, the system must apply consent-based data collection, restricted access, audit logging, and privacy controls such as blurring faces, license plates, or sensitive visual content. In addition, the emergency alert interface must be simple enough for senior citizens, persons with disabilities, and users with limited technical ability, using large buttons, clear labels, recognizable icons, and minimal steps. SMS backup may also be considered as a contingency feature when internet access is unavailable, subject to technical and budget feasibility.   
Overall, the reviewed literature supports the development of E-Boses as a barangay-level platform that combines civic engagement, structured community feedback, AI-assisted validation, and emergency coordination. The system directly responds to the governance needs documented across the reviewed literature, studies, and systems by providing verified user access, structured report submission, AI-assisted severity, location-based emergency routing, role-based responder access, privacy protection, and resident feedback tracking. 

**Chapter 3**

**METHODOLOGY**

**Requirements Analysis**  
The requirements for E-Boses were identified through a structured consultation with the Barangay Captain of Marikina Heights and a review of how the barangay currently handles community concerns and emergency situations. The findings from that consultation, together with the problems documented in the Fishbone Diagram and the Problem and Solution Statement, were used to define what the system must be able to do and how it must behave.

Functional requirements describe the specific tasks and features the system must provide to its users. The system shall validate every user, report, and location before a report or emergency alert triggers an action. User validation shall include OTP verification and valid identification review. Report validation shall include NLP-based relevance checking, fake or irrelevant report detection, and duplicate detection using text and image comparison. Location validation shall include GPS accuracy checking, barangay boundary verification, and manual map pinning when location services are disabled or unavailable. After validation, the system shall trigger the appropriate action. Normal concerns shall be classified, scored, stored, and forwarded to the barangay official dashboard for review and action. Emergency alerts shall be classified by emergency type and routed to the appropriate responder role, such as BHW, BDRRMO, or barangay *tanod*.

Non-functional requirements describe how the system should perform and behave, rather than what it does. These cover how safe, reliable, and easy to use the system must be. Because the system collects personal information, including residents' photos, written descriptions, and location data, it is designed to comply with the Data Privacy Act of 2012, or Republic Act No. 10173\. In practice, this means three things. First, every user must confirm their identity before they can access the system, using a one-time verification code sent to their registered phone or email. Second, each type of user can only see and do what is appropriate for their role. For example, a resident can only view their own submitted reports, while a barangay official can view all reports submitted within their barangay. Third, all records are stored securely online and backed up automatically, so that no data is lost even if a computer breaks down.

**Requirements-Features Matrix**  
Table 3 maps each identified problem to its corresponding functional or non-functional requirement and the specific system feature implemented to address it. This matrix ensures that every module in E-Boses is directly traceable to a documented community or governance need, and provides the basis for system testing and evaluation.

Table 3  
 **Requirements-Features Matrix**

| REQUIREMENTS / FEATURES | STRQ1: Allow residents to report concerns and track their submission | STRQ2: Automatically assess and rank how serious reported concerns are | STRQ3: Allow residents to send location-based emergency alerts to barangay responders | STRQ4: Notify nearby residents to assist during emergencies |
| :---- | ----- | ----- | ----- | ----- |
| FEAT1:  The system will allow residents to submit a concern with a photo, written description, and GPS location, and receive a tracking number to monitor its resolution status. | **√**  |  |  |  |
| FEAT2: The system will automatically analyze submitted photos using a computer vision model to assess damage severity and analyze written descriptions using an NLP model to filter fake or irrelevant report, producing a priority score to guide official response. |  | **√**  |  |  |
| FEAT3: The system will generate GPS-tagged emergency alerts and automatically route them to the nearest available responders. |  |  | **√**  |  |
| FEAT4: The system will notify verified residents near an emergency location to assist while responders are on the way. |  |  |  | **√**  |

| REQUIREMENTS / FEATURES | STRQ5: Validate user identity, report content, location, and uploaded media before reports are accepted  | STRQ6: Automatically route emergency alerts to the correct responder role | STRQ7: Protect uploaded media and personally identifiable information | STRQ8: Provide accessible emergency reporting for senior citizens |
| :---- | ----- | ----- | ----- | ----- |
| FEAT5: User verification, report validation, duplicate detection, GPS validation, and media authenticity checking. | **√**  |  |  |  |
| FEAT6: Role-based routing to BHW, BDRRMO, or *tanod*. |  | **√**  |  |  |
| FEAT7: Media blurring, restricted access, consent capture, audit logs, and RBAC. |  |  | **√**  |  |
| FEAT8: Large emergency button, simple labels, icons, confirmation timer, and SMS backup. |  |  |  | **√**  |

**Use Case Diagram**  
**Figure 4\. General Use Case Diagram**

    
**Figure 5\. Login Use Case Diagram** 

     

**Figure 6\. Register Use Case Diagram**   
    
**Figure 7\. Submit a Community Concern Use Case Diagram**

 **Figure 8\. Review Submitted Concerns Use Case Diagram**

**Figure 9\. Send Emergency Alert Use Case Diagram** 

**Figure 10\. Respond to Emergency Alert Use Case Diagram**

**Figure 11\. Support a Community Concern Use Case Diagram**

**Figure 12\. Manage System Settings Use Case Diagram**

**Use Case Report**  
Tables 4 to 11 present the detailed use case reports for the five main interactions in E-Boses. Each report outlines the actors involved, preconditions, step by step flow of events, postconditions, and exception handling.

Table 4  
**User Login**

| Use Case ID | UC-01 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A registered user enters their registered email to log into the system. If the user forgets their password, they may request password recovery and request a new code if needed. |  |
| **Triggering Event** | The user selects the login option and enters their registered email. |  |
| **Brief Description** | To access the system, the user enters their registered email on the login page. If the user forgets their password, the system provides a password recovery process and allows requesting a new code. If login credentials are invalid, the system displays a login failed message. |  |
| **Actors**  | Resident, Barangay Official |  |
| **Included Use Case** | Include: Enter Registered Email, Password |  |
| **Extend Use Case**  | Extend: Forgot Password, Request a New Code, Login Failed  |  |
| **Pre-Conditions** | The user must already have a registered account in the system. |  |
| **Post-Conditions**  | The user successfully logs into the system and is redirected to their corresponding dashboard. |  |
|  **Normal Flow** | **Actors**  | **System**  |
|  | The user opens the login page.  The user enters their registered email and password. The user accesses the system upon successful login. | The system displays the login form. The system checks if the email is registered The system verifies the entered credentials. The system redirects the user to their corresponding dashboard. |
|  **Alternative Flow** | The resident selects “Forgot Password.” and requests a new code if the previous code expires. The system starts the password recovery process and sends a new verification code to the registered email. |  |
|  **Postconditions** | The concern is stored with severity, a reference number, and status ‘Submitted.’ The resident can monitor resolution progress using the tracking number. |  |
| **Exceptions** | The user enters invalid login credentials and the system displays a “Login Failed” message and denies access to the system. |  |

Table 5  
**Register Account**

| Use Case ID | UC-02 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A resident creates a new account by entering personal information, creating login credentials, and uploading a valid ID for verification. |  |
| **Triggering Event** | The resident selects the register option on the system.  |  |
| **Brief Description** | To create an account, the resident enters personal information, verifies OTP, creates login credentials, and uploads a valid ID. Before OCR, the system automatically checks if the uploaded ID is edited, manipulated, AI-generated, duplicated, unreadable, or suspicious. If the ID fails validation, the system automatically rejects the registration. If valid, OCR extracts ID details and compares them with the submitted information. |  |
| **Actors** | Resident, Barangay Official |  |
| **Included Use Case** | Include: Enter Personal Information, Verify OTP, Upload Valid ID, Check ID Authenticity, Detect Edited or AI-Generated ID, Check ID File Hash, Check ID Quality, Validate ID Using OCR, Compare OCR Details, Check Duplicate Account |  |
| **Extend Use Case**  | Extend: Invalid OTP, Expired OTP, Unreadable ID, Edited or Manipulated ID, AI-Generated ID, Duplicate ID, OCR Mismatch, Registration Rejected |  |
| **Pre-Conditions** | The resident must not already have an existing account in the system.  |  |
| **Post-Conditions**  | The resident account is successfully created and verified, allowing access to the system.  |  |
|  **Normal Flow** | **Actors**  | **System**  |
|  | The resident opens the registration page. The resident enters personal information.  The resident enters an email or phone number. The resident enters the OTP. The resident creates login credentials. The resident uploads a valid ID. The resident submits the registration form..  | The system displays the registration form.  The system checks required fields and validates format. The system sends an OTP to the registered contact. The system verifies whether the OTP is valid and not expired. The system checks if the ID is edited, manipulated, AI-generated, or suspicious. If valid, the system proceeds to OCR. The system compares OCR-extracted ID details with the submitted personal details and flags mismatches. The system approves or rejects the account based on validation results. |
|  **Alternative Flow** | If the uploaded ID is readable but details are unclear or incomplete, the system requests resubmission. The system marks the account as "Resubmission Required" and notifies the resident to upload a clearer ID. |  |
| **Exceptions** | Invalid OTP; expired OTP; unreadable ID; edited/manipulated ID; AI-generated ID; duplicate ID hash; OCR mismatch; incomplete registration details.  |  |

Table 6  
**Submit a Community Concern**

| Use Case ID | UC-03 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A verified resident submits a community concern by selecting a category, entering a description, uploading photo evidence, and providing GPS or manually pinned location. |  |
| **Triggering Event** | The resident selects the “Submit a Concern” option in the system. |  |
| **Brief Description** | To submit a concern, the resident provides a category, description, photo, and location. The system automatically validates the user, report text, uploaded media, and location before accepting the report. Fake, irrelevant, duplicate, edited, AI-generated, invalid-location, or suspicious reports are automatically rejected. Only valid reports proceed to YOLOv8 severity scoring, then priority ranking, and tracking number generation. |  |
| **Actors** | Resident, Barangay Official  |  |
| **Included Use Case** | Include: Choose Concern Category, Enter Description, Upload Photo, Validate User, Detect Fake or Irrelevant Report, Check Duplicate Text Hash, Check Media Authenticity, Detect Edited or AI-Generated Media, Check Image Hash, Validate GPS, Check Barangay Boundary, Manual Map Pinning, YOLOv8 Severity Scoring, NLP fake / irrelevant report analysis, Generate Tracking Number |  |
| **Extend Use Case**  | Extend: Save Draft if No Connection, Auto-Reject Fake Report, Auto-Reject Duplicate Report, Auto-Reject Invalid Media, Auto-Reject Outside Barangay Boundary |  |
| **Pre-Conditions** | The resident must be logged into the system before submitting a concern. |  |
| **Post-Conditions**  | The concern is either accepted and assigned a tracking number or automatically rejected if validation fails. |  |
|  **Normal Flow** | **Actors**  | **System**  |
|  | The resident opens the concern submission page. The resident selects a concern category.  The resident enters a description. The resident uploads a photo. The resident allows GPS or manually pins the location.  The resident submits the concern. | The system displays the concern form. The system analyzes the text using NLP for relevance, and fake/irrelevant content. The system checks duplicate text hash. The system checks the photo for authenticity, quality, metadata, duplicate hash, edited/manipulated indicators, and AI-generated indicators. The system validates GPS accuracy or manual pin location. The system checks if the location is within the barangay boundary. If any validation fails, the system automatically rejects the report. If valid, the system proceeds to YOLOv8 severity scoring. The system generates priority scores and tracking numbers. The system forwards the report to the barangay dashboard. |
|  **Alternative Flow** | If GPS is unavailable or disabled, the resident manually pins the location on the map. |  |
| **Exceptions** | Unverified user; incomplete details; fake or irrelevant text; duplicate report; edited/manipulated or AI-generated photo; invalid media; location outside barangay boundary. |  |

Table 7  
**Review Submitted Concerns**

| Use Case ID | UC-04 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A barangay official reviews only validated and accepted concern reports. |  |
| **Triggering Event** | The barangay official opens the submitted concerns module. |  |
| **Brief Description** | The barangay official reviews accepted concerns with AI scores, validation status, media authenticity status, and location validation result. Fake, duplicate, invalid, edited, or AI-generated reports are already filtered out by the system and do not appear in the main concern dashboard. |  |
| **Actors** | Barangay Official  |  |
| **Included Use Case** | Include: View Concern Details, View AI Scores, View Validation Results, View Media Authenticity Status, View Location Validation Status, Update Status, Notify Resident, Override AI Score, Record Override Reason |  |
| **Extend Use Case**  | Extend: Restrict Sensitive Media, Forward to Appropriate Office |  |
| **Pre-Conditions** | The concern must have passed automatic system validation. |  |
| **Post-Conditions**  | The concern status and action history are updated. |  |
|  **Normal Flow** | **Actors**  | **System**  |
|  | The barangay official opens the concern review page. The official selects a concern. The official reviews the concern details. The official updates the status or adjusts the AI score. The official sends an update to the resident. | The system displays only validated concerns sorted by priority. The system shows description, photo, location, priority ranking, validation results, and media authenticity status.  If the AI score is changed, the system requires a reason and updates the priority ranking. The system saves the status update.  The system notifies the resident. |
|  **Alternative Flow** | The barangay official adjusts the system’s assessment if the assigned priority ranking is inaccurate. |  |
| **Exceptions** | Missing reason for adjusting the assessment; restricted media access; concern record cannot be retrieved. |  |

Table 8  
**Send Emergency Alert**

| Use Case ID | UC-05 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A verified resident sends an emergency alert using a large emergency button, provides location, optionally attaches media, and the system routes the alert to the correct responders. |  |
| **Triggering Event** | The resident selects the emergency alert feature in the system. |  |
| **Brief Description** | To send an emergency alert, the resident presses a large emergency button, confirms the alert, selects or describes the emergency, and provides GPS or manually pinned location. The system automatically validates the user, alert content, location, and optional media. Fake, duplicate, invalid, edited, or AI-generated emergency submissions are automatically filtered. Valid emergency alerts are classified using NLP and routed to BHW, BDRRMO, or barangay *tanod*. |  |
| **Actors** | Resident, BHW, BDRRMO, Barangay Tanod, Barangay Official |  |
| **Included Use Case** | Include: Press Emergency Button, Confirm Alert, Capture GPS, Manual Map Pinning, Validate Location, Check Emergency Media Authenticity, Detect Edited or AI-Generated Media, Apply Privacy Blur, Classify Emergency Type Using NLP, Route Alert to Assigned Responder, Notify Resident of Status |  |
| **Extend Use Case**  | Extend: Attach Photo or Video, Cancel Alert Before Broadcast, Notify Nearby Witnesses, SMS Backup Consideration, Auto-Reject Invalid Emergency Alert |  |
| **Pre-Conditions** | The resident must be logged into the system and have internet access. |  |
| **Post-Conditions**  | The valid emergency alert is routed to the correct responder role and recorded in the system. |  |
|  **Normal Flow** | **Actors**  | **System**  |
|  | The resident presses the emergency button. The resident confirms the alert. The resident selects or describes the emergency.  The resident allows GPS or manually pins location. The resident optionally uploads photo/video.  The resident waits for status updates. | The system displays a large, simple emergency form with a confirmation timer.  The system validates the user and location.  The system checks optional media for authenticity, quality, metadata, duplicate hash, edited/manipulated indicators, and AI-generated indicators. The system filters invalid or fake emergency submissions. The system applies privacy blur or restricts sensitive media when needed. The system classifies the emergency as medical, fire, disaster, crime, or other.  The system routes medical alerts to BHW, fire/disaster alerts to BDRRMO, and crime alerts to barangay *tanods*. The system sends status updates to the resident. |
| **Alternative Flow** | If GPS is unavailable, the resident manually pins the location. If the internet is unavailable, SMS backup fallback |  |
| **Exceptions** | Unverified user; missing location; invalid emergency details; edited/manipulated or AI-generated media; duplicate emergency alert |  |

Table 9  
**Respond to Emergency Alert**

| Use Case ID | UC-06 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A responder receives a valid emergency alert assigned according to role, acknowledges it, updates status, and records the resolution outcome. |  |
| **Triggering Event** | The system routes a validated emergency alert to the assigned responder role. |  |
| **Brief Description** | The system routes only validated emergency alerts to the correct responder role. Medical alerts go to BHW, fire/disaster alerts go to BDRRMO, and crime-related alerts go to barangay *tanods*. Responders can only view alerts assigned to their role through RBAC. |  |
| **Actors** | BHW, BDRRMO, Barangay Tanod, Barangay Official |  |
| **Included Use Case** | Include: Receive Assigned Alert, View Alert Details, View Media Review Status, Acknowledge Alert, Update Response Status, Record Resolution Outcome, Escalate Unacknowledged Alert |  |
| **Extend Use Case**  | Extend: Escalate to Barangay Official, Escalate to All On-Duty Responders, Restrict Raw Media Access |  |
| **Pre-Conditions** | A validated emergency alert must exist and must already be classified by emergency type. |  |
| **Post-Conditions**  | The alert is acknowledged, responded to, resolved, escalated, or closed with an outcome record. |  |
|  **Normal Flow** | **Actors**  | **System** |
|  | The responder receives an assigned alert. The responder opens the alert. The responder acknowledges the alert. The responder updates response status. The responder records the outcome. | The system routes only validated alerts based on the emergency category. The system displays only alerts assigned to the responder’s role. The system shows alert details, location, validation status, and media status. The system updates the alert status to acknowledge/respond. The system stores the resolution outcome. |
| **Alternative Flow** | If the alert is not acknowledged within the required time, the system escalates it to barangay officials or all authorized on-duty responders. |  |
| **Exceptions** | No responder available; responder tries to access unassigned alert; restricted media access. |  |

Table 10  
**Support a Community Concern**

| Use Case ID | UC-07 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A resident views validated public concerns and supports or withdraws support from a concern. |  |
| **Triggering Event** | The resident navigates to the “Community Concerns” or feed section of the system. |  |
| **Brief Description** | Residents may support only validated and privacy-safe community concerns. Reports automatically rejected by validation filters are not displayed. Reports with restricted media or sensitive details are hidden or privacy-protected. |  |
| **Actors** | Resident |  |
| **Included Use Case** | Include: View Validated Concerns, View Privacy-Safe Details, Add Vote, Withdraw Vote, Update Priority Ranking |  |
| **Extend Use Case**  | Include: View Validated Concerns, View Privacy-Safe Details, Add Vote, Withdraw Vote, Update Priority Ranking |  |
| **Pre-Conditions** | The resident must be logged in and verified. At least one validated public concern must exist. |  |
| **Post-Conditions**  | The vote count and priority ranking are updated. |  |
|  **Normal Flow** | **Actors**  | **System** |
|  | The resident opens the community concerns module. The resident selects a concern. The resident adds or withdraws support. | The system displays only validated concerns approved for public viewing. The system hides or blurs restricted media. The system records the vote or removes it. The system updates the vote count and priority ranking. |
| **Alternative Flow** | The resident may simply browse concerns without adding or withdrawing votes.  |  |
| **Exceptions** | Duplicate vote; resolved concern; restricted media; unvalidated concern. |  |

Table 11  
**Manage System Settings**

| Use Case ID | UC-08 |  |
| :---- | :---- | :---- |
|  **Scenarios** | A barangay official or system administrator manages users, roles, validation rules, privacy settings, emergency routing, and audit logs. |  |
| **Triggering Event** | The official logs in with administrative privileges and opens the system settings module. |  |
| **Brief Description** | This use case allows authorized users to manage accounts, roles, RBAC permissions, and view audit logs. |  |
| **Actors** | Barangay Official (Captain, Secretary) |  |
| **Included Use Case** | Include: Manage User Roles, Manage Privacy Settings, View Audit Logs |  |
| **Extend Use Case**  | Extend: Approve or Reject User, Suspend Account, Reassign Active Alert, Update Privacy Rules, Update Validation Rules |  |
| **Pre-Conditions** | The official must be logged in with administrative privileges. |  |
| **Post-Conditions**  | User roles, validation settings, routing settings, privacy settings, and audit logs are updated. |  |
|  **Normal Flow** | **Actors**  | **System** |
|  | The official opens system settings. The official manages users and roles. The official configures validation rules. The official updates privacy and routing settings. The official reviews audit logs. | The system displays user, validation, routing, privacy, and audit modules. The system updates user roles. The system updates RBAC permissions The system logs all administrative actions. |
| **Alternative Flow** | If an action is executed, the system records the change in the audit log. |  |
| **Exceptions** | \- |  |

**Design Specifications**

**Activity Diagram**  
This section introduces the model of the dynamic behavior of the E-Boses system by illustrating the sequence of actions, decision points, and interactions among system actors. Each diagram follows a swimlane structure to clearly delineate the responsibilities of each actor involved in a given process. The two activity diagrams presented below correspond to the two active modules of the system: Civic Concern Reporting and Emergency Alert Coordination.

**Figure 13\. Activity Diagram of Concern Reporting**

**Figure 14\. Activity Diagram of Emergency Alert**	  
     
**Database Schema**  
E-Boses stores all its data in an organized database made up of ten tables grouped into three areas. The first area handles accounts and access, storing barangay information, user roles, and resident accounts. The second area manages concern reports, storing submitted reports, their status updates, and community upvotes. The third area handles emergency alerts, storing the alerts sent, which responders acknowledged them, and which nearby residents were notified. A separate log table records every important action done in the system for accountability.  
Each record in the database is assigned a unique ID that cannot be guessed or predicted, keeping the data secure. The database is also set up so that no report or alert can exist without a valid resident and barangay linked to it, preventing incomplete or orphaned records. Finally, the data is structured to avoid duplication, for example, status updates and responder acknowledgments are stored in their own separate tables rather than repeatedly copying the same information, keeping the database clean, consistent, and easy to maintain.

**Figure 15\. Entity Relationship Diagram of E-Boses**   
 

**Data Dictionary**  
This section provides a detailed description of the data used in the system. It defines each data field, including its name, type, purpose, and possible values. This helps ensure that the data are organized consistently and supports accurate system development, data management, and documentation.  
Table 12  
**barangays**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX  | PK, NOT NULL | Unique barangay identifier, auto-generated on creation | 550e8400-e29b-41d4-a716-446655440000 |
| name | VARCHAR | 100 | Text, max 100 characters | NOT NULL | Official barangay name as registered with the LGU | San Andres |
| municipality | VARCHAR | 100 | Text, max 100 characters | NOT NULL | Parent municipality or city of the barangay | Manila |
| region | VARCHAR | 100 | Text, max 100 characters | NOT NULL | Administrative region | NCR |

Continuation of **Table 12**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| alert\_radius\_meters | INTEGER |  | Positive digits only | NOT NULL, DEFAULT \= 500 | Radius in meters for witness notifications | 500 |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when barangay profile was created | 2025-01-15 08:30:00 |

Table 13  
**users**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique user identifier, auto-generated on registration | 123e4567-e89b-12d3-a456-426614174000 |
| barangay\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → barangays.id | Barangay the user is registered under | 550e8400-e29b-41d4-a716-446655440000 |
| role\_id | SMALLINT |  | 1, 2, 3, 4 | NOT NULL, FK → roles.id | Determines system features and data access | 1 |

Continuation of **Table 13**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| full\_name | VARCHAR | 150 | Text, max 150 characters | NOT NULL | User's full legal name as entered during registration | Juan Dela Cruz |
| email | VARCHAR | 150 | Email format: xxx@xxx.xxx | NOT NULL, UNIQUE | Email address used for OTP delivery | juan.delacruz@email.com |
| otp\_hash | VARCHAR | 255 | Bcrypt hash (starts with $2b$10$) | NULLABLE | Bcrypt hash of the currently active OTP | $2b$10$N9qo8... |
| otp\_expires\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NULLABLE | Expiry timestamp of the active OTP (5-minute window) | 2025-04-28 10:35:00 |
| is\_verified | BOOLEAN |  | true/false or 1/0 | NOT NULL, DEFAULT \= FALSE | Set to TRUE after successful OTP verification | TRUE |

Continuation of **Table 13**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| consent\_given | BOOLEAN |  | true/false or 1/0 | NOT NULL, DEFAULT \= FALSE | RA 10173 data privacy consent acknowledged | TRUE |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when user account was created | 2025-04-01 09:15:00 |

Table 14  
**concern\_reports**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique report identifier | 789e4567-e89b-12d3-a456-426614174111 |
| resident\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | Resident who submitted the report | 123e4567-e89b-12d3-a456-426614174000 |

Continuation of **Table 14**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| barangay\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → barangays.id | Barangay under which report is filed | 550e8400-e29b-41d4-a716-446655440000 |
| tracking\_number | VARCHAR | 20 | RPT-YYYY-NNNN | NOT NULL, UNIQUE | System-generated reference code | RPT-2025-0041 |
| category | VARCHAR | 50 | Text, max 50 characters | NOT NULL | Concern classification selected by resident | Infrastructure |
| description | TEXT |  | Free text, min 20 characters | NOT NULL | Resident's written description (Filipino/Taglish) | Sira ang tulay sa barangay hall |
| photo\_url | VARCHAR | 500 | Cloudinary CDN URL format | NULLABLE | URL of uploaded concern photo | https://res.cloudinary.com/.../photo.jpg |
| latitude | DECIMAL | (10, 7\) | \#.\#\#\#\#\#\#\# | NOT NULL | GPS latitude of reported location | 14.5892345 |
| longitude | DECIMAL | (10, 7\) | \#.\#\#\#\#\#\#\# | NOT NULL | GPS longitude of reported location | 121.0203456 |
| zone | VARCHAR | 50 | Text, max 50 characters | NULLABLE | Barangay zone label | Zone B |

Continuation of **Table 14**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| severity\_score | SMALLINT |  | Single digit: 1-5 | NOT NULL, CHECK (1–5) | YOLOv8 damage severity score | 4 |
| ai\_confidence\_flag | BOOLEAN |  | true/false or 1/0 | NOT NULL, DEFAULT \= FALSE | TRUE if YOLOv8 confidence below threshold | FALSE |
| severity\_override | SMALLINT |  | Single digit: 1-5 | NULLABLE, CHECK (1–5) | Manual severity adjustment by official | NULL |
| status | VARCHAR | 30 | Text, max 30 characters | NOT NULL, DEFAULT \= 'Submitted' | Current resolution status | In Progress |

Continuation of **Table 14**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| vote\_count | SMALLINT  |  | Digits | NOT NULL, DEFAULT \= 0, CHECK ≥ 0 | Running total of upvotes received for this report | 15 |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when report was submitted | 2025-04-28 08:15:30 |

Table 15  
**concern\_votes** 

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique identifier for each vote record | a1b2c3d4-e5f6-7890-abcd-ef1234567890 |
| report\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → concern\_reports.id | Reference to the concern report being voted on | 789e4567-e89b-12d3-a456-426614174111 |

Continuation of **Table 15**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| resident\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | Reference to the resident who cast the vote | 123e4567-e89b-12d3-a456-426614174000 |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when the vote was cast | 2025-04-28 08:15:30 |

Table 16  
**roles**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| id | SMALLINT |  | 1, 2, 3, 4 | PK, NOT NULL | Numeric role identifier | 1 |
| name | VARCHAR | 50 | Text, max 50 characters | NOT NULL, UNIQUE | Role label used by RBAC system | resident |

Table 17  
**emergency\_alerts**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique alert identifier | 111e4567-e89b-12d3-a456-426614174444 |
| resident\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | Resident who submitted the alert | 123e4567-e89b-12d3-a456-426614174000 |
| barangay\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → barangays.id | Barangay under which alert is broadcast | 550e8400-e29b-41d4-a716-446655440000 |

Continuation of **Table 17**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| alert\_type | VARCHAR | 30 | Text, max 30 characters | NOT NULL | Emergency category selected by resident | Medical |
| description | TEXT |  | Free text | NULLABLE | Optional short note providing context | Matanda na nahulog sa hagdan |
| photo\_url | VARCHAR | 500 | Cloudinary CDN URL format | NULLABLE | URL of optional alert photo | [https://res.cloudinary.com/.../alert.jpg](https://res.cloudinary.com/.../alert.jpg) |
| latitude | DECIMAL | (10, 7\) | \#.\#\#\#\#\#\#\# | NOT NULL | GPS latitude of emergency location | 14.5892345 |
| longitude | DECIMAL | (10, 7\) | \#.\#\#\#\#\#\#\# | NOT NULL | GPS longitude of emergency location | 121.0203456 |
| status | VARCHAR | 40 | Text, max 40 characters | NOT NULL, DEFAULT \= 'Sent' | Current alert status | Responding |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when alert was submitted | 2025-04-28 10:34:22 |

Table 18  
**alert\_acknowledgments**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique acknowledgment record identifier | 222e4567-e89b-12d3-a456-426614174555 |
| alert\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → emergency\_alerts.id | Emergency alert this acknowledgment is for | 111e4567-e89b-12d3-a456-426614174444 |
| responder\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | First responder who interacted with alert | 888e4567-e89b-12d3-a456-426614174666 |
| status | VARCHAR | 30 | Text, max 30 characters | NOT NULL | Responder's action outcome | Resolved |
| acknowledged\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NULLABLE | Timestamp when responder tapped Acknowledge | 2025-04-28 10:36:10 |

Continuation of **Table 18**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| resolved\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NULLABLE | Timestamp when incident was marked Resolved | 2025-04-28 11:15:45 |
| outcome\_note | TEXT |  | Free text | NULLABLE | Brief incident outcome summary on resolution | Patient transported to health center |

Table 19  
**report\_status\_history**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique log entry identifier | 444e4567-e89b-12d3-a456-426614174999 |
| user\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NULLABLE, FK → users.id | User who performed the action | 123e4567-e89b-12d3-a456-426614174000 |
| action | VARCHAR | 100 | Text, max 100 characters | NOT NULL | Standardized action label | REPORT\_SUBMITTED |

Continuation of **Table 19**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| table\_affected | VARCHAR | 50 | Text, max 50 characters | NOT NULL | Name of database table involved | concern\_reports |
| record\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NULLABLE | UUID of the specific affected record | 789e4567-e89b-12d3-a456-426614174111 |
| ip\_address | VARCHAR | 45 | IPv4 or IPv6 format | NULLABLE | Client IP address at time of action | 192.168.1.15 |
| created\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp of the logged event | 2025-04-28 08:15:32 |

Table 20  
**system\_audit\_log**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique history record identifier | 456e7890-e89b-12d3-a456-426614174222 |
| report\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → concern\_reports.id | Concern report to which status change belongs | 789e4567-e89b-12d3-a456-426614174111 |
| updated\_by | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | Barangay official who performed the status update | 999e4567-e89b-12d3-a456-426614174333 |
| old\_status | VARCHAR | 30 | Text, max 30 characters | NOT NULL | Status value prior to the update | Submitted |
| new\_status | VARCHAR | 30 | Text, max 30 characters | NOT NULL | Status value applied by the official | In Progress |

Continuation of **Table 20**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| resolution\_note | TEXT |  | Free text | NULLABLE | Mandatory summary note when status is Resolved or Deferred | Forwarded to DPWH for repair schedule |
| updated\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp of the status change event | 2025-04-29 10:22:15 |

Table 21  
**witness\_notification**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | :---- |
| id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | PK, NOT NULL | Unique notification dispatch record | 333e4567-e89b-12d3-a456-426614174777 |
| alert\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → emergency\_alerts.id | Emergency alert that triggered this notification | 111e4567-e89b-12d3-a456-426614174444 |
| resident\_id | UUID | 36 | XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX | NOT NULL, FK → users.id | Resident who received the in-app witness notification | 777e4567-e89b-12d3-a456-426614174888 |

Continuation of **Table 21**

| Attribute  | Data Type | Size | Format | Other Constraints | Description | Sample Value |
| :---- | :---- | ----- | :---- | :---- | :---- | ----- |
| sent\_at | TIMESTAMP |  | YYYY-MM-DD HH:MM:SS | NOT NULL, DEFAULT \= NOW() | Timestamp when notification was dispatched by server | 2025-04-28 10:34:25 |
| delivery\_status | VARCHAR | 20 | Text, max 20 characters | NOT NULL, DEFAULT \= 'Delivered' | In-app delivery result; Failed if Socket.IO event doesn't reach active session | Delivered |

**Development Methodology**   
**Process Model**  
The development of E-Boses is planned to follow a structured sequential process model inspired by the Waterfall methodology, while still allowing adjustments for AI model integration and user acceptance validation. Instead of being limited to a single framework, the development process will be organized into four main phases: Environment Setup, Core Module Development, Integration and Testing, and Community Rollout. Each phase will have specific deliverables and criteria that must be completed before moving to the next stage. This approach is intended to support organized progress, reduce disruption to local operations, and prepare future users for smooth adoption.  
The process will begin with the Environment Setup phase, where the necessary resources for system development will be prepared. This includes configuring cloud storage, setting up the database, and establishing a private testing server where the platform can be safely developed and evaluated. Security measures will also be implemented to help protect user data throughout the development process.  
After the environment has been prepared, the project will proceed to the Core Module Development phase. During this stage, the main features of the system will be developed. The Civic Concern Reporting feature will allow residents to register, submit reports with photos and location details, and monitor the status of their concerns. The Emergency Alert feature will enable users to send distress signals that can be routed to authorized responders. At the same time, an admin dashboard will be developed to help local officials view, manage, and respond to submitted concerns and alerts.

Once the core features have been completed, the Integration and Testing phase will combine all modules into one functional platform. The system will be tested to ensure that each feature works properly, that the platform can handle expected real-world use, and that sensitive information is only accessible to authorized users. Selected users may also be invited to test the platform and provide feedback, which will be used to improve the system before deployment.

The final phase will be the Community Rollout, where the completed system will be introduced to its intended users. Local staff will be trained on how to use the dashboard, manage reports, and respond to emergency alerts. Residents will also be informed about the platform through announcements, social media posts, and printed materials. To support a smoother transition, a short adjustment period may be provided where traditional reporting methods remain available while users become familiar with the new system. After the official launch, the system will continue to be monitored so that concerns, technical issues, or user feedback can be addressed properly.

**Development Tools**  
The E-Boses system is planned to be developed using a Python-first technology stack to ensure technical coherence, maintainability, and alignment with the project's AI-integrated requirements. The backend framework will employ Django, a robust and well-documented Python web framework, selected for its native compatibility with the system's artificial intelligence components: YOLOv8 for computer vision-based severity analysis and jcblaise/roberta-tagalog-base for natural language processing of Filipino and Taglish text.  
The frontend will utilize React.js with Tailwind CSS to deliver a lightweight, mobile-responsive interface accessible via standard web browsers. This design satisfies the requirement for a no-native-installation deployment model, ensuring that residents can access the platform using any smartphone without downloading a dedicated application. For location-based functionalities, including radius-based witness notifications and GPS-tagged emergency alerts, the system will be supported by PostgreSQL with the PostGIS extension, which provides efficient handling of geospatial queries.  
Real-time emergency alert coordination will be implemented using Django Channels with WebSocket support, enabling persistent, low-latency communication between residents and first responders. User authentication will leverage OTP-based verification via Twilio, ensuring secure, identity-verified access without requiring complex telephony infrastructure. Media files submitted by residents will be managed through Cloudinary, which provides automated image optimization to reduce bandwidth consumption on mobile networks.  
The complete platform will be developed using Visual Studio Code, version-controlled via Git and GitHub, tested using Postman, and deployed on Render, a cloud platform that supports Python-based applications with managed PostgreSQL and WebSocket capabilities. Supplementary tools will include Figma for interface prototyping, draw.io for system diagramming, Jupyter Notebook and Google Colab for AI model validation, and Roboflow for dataset annotation.  
This integrated stack is deliberately planned to balance functional requirements, accessibility constraints, and development feasibility. By keeping AI, geospatial, and real-time components within a single Python-based environment, the proposed architecture avoids the operational complexity of bridging multiple language runtimes. This approach ensures that the system remains implementable within the scope and timeline of a capstone project while adhering to established software engineering practices.

**Test Methodology/Procedures**  
This section outlines the systematic strategies used to validate the performance, functionality, and accuracy of the E Boses system. Testing is conducted to identify and address issues while ensuring the system meets its intended goals and works reliably for everyday users. The process follows a step by step approach, beginning with individual component checks and progressing to full system evaluation and real user feedback.  
Initial testing focuses on individual parts of the system to confirm that each function works correctly on its own. This includes verifying that account setup and identity confirmation operate smoothly, that location information is captured accurately during report submission, and that notifications are generated and sent as expected. Once these components are validated, they are combined and tested together to ensure the full workflow functions properly from start to finish.  
The system's ability to understand and categorize concern reports is evaluated using prepared datasets containing sample photos and written descriptions. These tests measure how well the system identifies the seriousness of visual reports and the relevance of text based submissions. The target is to achieve a high level of correct classification, with accuracy meeting or exceeding the established benchmark for reliable automated assessment.  
Performance testing examines how quickly and consistently the system delivers time sensitive notifications. Simulated alerts are sent under normal network conditions to verify that messages reach intended recipients within a short and acceptable time frame. The goal is for the majority of test deliveries to meet the target response window, ensuring the system can support timely communication during urgent situations.  
Finally, User Acceptance Testing involves selected residents and barangay officials who interact with the system by completing common tasks such as submitting reports, checking status updates, and using the alert feature. Their experience is observed and feedback is gathered through structured surveys. The project aims for a high rate of positive responses regarding ease of use, clarity of the interface, and overall usefulness, ensuring the system is practical and accessible for its intended users.

**System Requirements**  
To ensure the effective operation of the E-Boses platform, the following hardware and software specifications are required. These requirements are based on the need for real-time AI processing and stable web-based access.  

Table 22  
**Minimum and Recommended System Requirements**

| Category | Minimum Requirement | Recommended Requirements |
| ----- | :---: | :---: |
|  **Processor** |  Intel Core i3 or equivalent (for basic administrative access) |  Intel Core i5 or higher (for smooth Al-dashboard management)  |
|  **RAM** |  4GB |  8GB or higher  |
|  **Storage** |  128 GB SSD (for local caching) | 256 GB SSD or higher (for faster data processing)  |
| **Network** | Mobile Data or 5Mbps Broadband  | Stable 20Mbps+ Fiber connection  |
|  **Software** |  Modern Web Browser (Chrome, Brave, Opera)  |  Latest versions of Chrome or Safari  |
| **Operating System** | Windows 10/11, Android 10+, or iOS 14+  |  Windows 11 or latest Mobile OS  |

**Quality Plan**  
The ISO 25010 quality model is used to ensure that E-Boses meets established quality standards. It covers six key characteristics: Functional Suitability, Reliability, Security, Usability, Maintainability, and Portability, each broken down into specific sub-characteristics for clear and thorough assessment.

Table 23  
**ISO 25010 Quality Model: Quality Characteristics of E-Boses**

| Quality Model  Characteristic | Description  |  |
| ----- | ----- | :---- |
|  Functional Suitability |  **Completeness** | The system supports report submission, validation, prioritization, emergency routing, privacy protection, and feedback tracking. |
|  |  **Correctness** | The system validates users, reports, media, and locations before triggering actions. |
|  |  **Appropriateness** | The system's features and functions are relevant and suitable to the actual needs of barangay residents, officials, and first responders. |
|  Performance Efficiency |  **Time Behaviour** | The system responds promptly to user actions such as submitting concern reports and triggering emergency alerts, minimizing wait times. |
|  |  **Resource Utilization**  | The system operates efficiently without consuming excessive device resources such as memory or processing power. |
|  |  **Capacity**  | The system can handle multiple simultaneous users submitting reports or sending emergency alerts without degrading in performance. |
|  Compatibility |  **Co-existence** | The system operates alongside other applications on the user's device without causing conflicts or interference. |
|  |  **Interoperability** | The system integrates effectively with external services such as email notifications via Gmail SMTP, cloud media storage via Cloudinary, and real-time communication via WebSocket. |
|  Interaction Capability |  **Learnability** |  New users, including elderly residents and those unfamiliar with technology, can quickly understand and use the system without prior training. |
|  |  **Operability** | The platform is easy to navigate, allowing residents to submit concern reports and send emergency alerts with just a few steps. |
|  |  **Inclusivity** | The interface supports senior citizens, PWDs, and users with limited technical ability. |
|  Reliability |  **Faultlessness** | The system operates consistently and correctly under normal conditions without producing unexpected errors or incorrect outputs. |
|  |  **Availability** | All reports and emergency data are saved and backed up automatically, so information is never lost and is always ready to access. |
|  |  **Fault Tolerance** | If GPS is unavailable, the system allows manual map pinning. |
|  |  **Recoverability** | In the event of a failure, the system promptly restores its operational state and retains all previously submitted data. |
|  Security  |  **Confidentiality**  | The system protects PII through RBAC, encrypted access, media restriction, and privacy blurring. |
|  |  **Integrity** | The system follows the Data Privacy Act of 2012 (RA 10173), ensuring that all submitted information remains accurate and unaltered. |
|  |  **Authenticity** | The system verifies user identity through OTP and ID review. |
|  Maintainability |  **Modifiability** | The system is built in an organized and modular way so that future improvements or additions can be made without disrupting features that are already working. |
|  |  **Testability** | The system's components are structured to allow individual unit and integration testing, ensuring each part functions correctly and as intended. |
|  Flexibility |  **Adaptability** | The system works on any web browser and device type, so users do not need any special configuration or setup to get started. |
|  |  **Installability** | The system is accessible directly through a web browser without requiring any separate installation or download on the user's device. |
|  Safety |  **Fail Safe** |  The system ensures emergency alerts are not lost or left undelivered in the event of a technical error, protecting users in critical situations. |
|  |  **Hazard Warning** | Emergency alerts are routed to assigned responders and escalated if unacknowledged. |

**Implementation Plan**   
The Implementation Plan explains how the proposed E-Boses: A Barangay Civic Engagement System with Integrated Emergency Coordination will be deployed and used in a real-world setting. The system will be deployed as a web-based platform hosted on a cloud server, making it accessible to all users through standard web browsers on mobile phones or computers without requiring any native application installation. This design ensures cross-platform accessibility for verified residents, barangay officials, first responders (*Tanods* and Barangay Health Workers), and system administrators, allowing each user group to access features appropriate to their role, such as structured concern reporting, AI-assisted priority scoring, GPS-tagged emergency alerts, and administrative dashboards.  
Prior to deployment, the platform will be configured according to the specific setup of the target barangay. This includes creating user accounts for barangay officials and first responders, assigning the appropriate role-based access control (RBAC) levels (e.g., Resident, Barangay Official, First Responder, System Administrator) so that each user can only see and perform actions relevant to their function. Existing records relevant to system use, such as the initial list of verified barangay personnel, will be encoded and entered into the system to ensure the platform reflects accurate barangay data from the moment it goes live. The system will undergo final testing in the live environment to confirm that core features are functioning properly, including civic concern submission with photo and GPS, AI-based severity analysis, generation of unique tracking numbers, GPS-tagged emergency alert routing, and real-time notifications to responders and nearby residents. This ensures that the system performs reliably, especially during intermittent network conditions common in some barangay zones.  
After successful validation and training, the system will be formally turned over to the Barangay Captain and the designated system administrator. A structured training session will be conducted to orient barangay officials, *tanods*, health workers, and selected residents on how to use the system. A printed and digital user guide in Filipino will be provided to all personnel as a reference for day-to-day operation. To ease the transition, a one-week period will be observed where residents can still use their usual reporting methods (walk-ins, phone calls) while getting familiar with the new system. Following deployment, the system will be monitored for two weeks to ensure proper functionality, and feedback may be gathered to support future improvements and system enhancement.

**Evaluation Plan**  
The evaluation of E-Boses will assess whether the system meets its core objectives: providing structured civic concern reporting, supporting AI-assisted prioritization, and coordinating emergency alerts. The assessment will be conducted through system testing and User Acceptance Testing (UAT) with selected residents and barangay officials from Barangay Marikina Heights.  
System performance will be measured using a prepared set of sample concern reports and simulated emergency alerts. These tests will determine how accurately the system analyzes submitted photos and written descriptions, and how quickly emergency alerts reach the intended responders. Server logs will be used to record and review the results.  
To assess usability, UAT participants will complete key tasks such as registering an account, submitting a photo-documented concern, tracking a report's status, and sending an emergency alert. Afterward, they will answer a structured survey using a five-point Likert scale covering ease of navigation, speed of alert functions, and overall usefulness. Open-ended comments and observation notes will also be gathered to identify common difficulties and interface strengths.  
Finally, the evaluation will include a descriptive comparison of barangay governance outcomes before and after system deployment, drawn from existing logbook records and the E-Boses database. Indicators such as the number of formally logged concerns and the time taken to update report statuses will be compared. All differences will be reported as observed trends rather than definitive conclusions, since the study does not involve a control barangay.

**Respondents**  
The respondents of this study were selected from verified residents, barangay officials, and first responders of Barangay Marikina Heights in Marikina City. The participants were purposively recruited to ensure representation across key user groups, comprising residents (including elderly persons, persons with disabilities, and working adults), barangay officials (Kagawads and the Barangay Captain), and first responders (*Tanods* and Barangay Health Workers). All respondents were at least eighteen years of age, had been residents or active personnel of the barangay for no less than six months, and voluntarily provided informed consent prior to participation in the user acceptance testing and survey administration.

**Ethical Considerations**   
The development and deployment of E-Boses are guided by the ethical principles of the Belmont Report and are in full compliance with the Data Privacy Act of 2012 (Republic Act No. 10173).  
Prior to registration, all participants are presented with a consent screen written in clear Filipino or Taglish, outlining the nature of data to be collected, its intended use, and the parties authorized to access it. Consent is obtained through an explicit acknowledgment before the user may proceed. Participation is entirely voluntary, and declining or withdrawing from the study will not affect a resident's access to barangay services. Participants retain the right to request the deletion of their account and associated data at any time.  
All personal and location data are secured during transmission and storage. Access to data is governed by role-based controls: residents may only view their own submitted reports, barangay officials may access all reports within their jurisdiction, and system administrators are restricted to technical logs. Location data is collected solely upon the resident's explicit consent. Under no circumstances will data be disclosed to third parties, external government agencies, or private organizations.  
The system incorporates a confirmation step prior to emergency alert submission to prevent accidental activations. Sensitive content, such as photographs of injuries or accidents, is stored under restricted access and is not made publicly visible. During User Acceptance Testing, participants are informed of their right to withdraw or decline any task at any point without consequence.  
The platform is accessible through any standard web browser and requires no installation, ensuring that residents with varying levels of technological familiarity are not excluded. No fees are imposed for any system function. Residents without access to smartphones may continue utilizing existing manual reporting channels, as E-Boses are designed to complement rather than replace traditional barangay processes.  
Prior to the commencement of any data collection activity, the research protocol will be submitted to the Polytechnic University of the Philippines College of Computer and Information Sciences for review and approval. Written authorization will likewise be secured from the Barangay Captain of Barangay Marikina Heights before any engagement with community participants.

**Data Analysis (Procedure and Treatment)**   
This section outlines the step-by-step procedures used to process and examine the information gathered during the evaluation of the proposed E-Boses system. The main goals of the analysis were to measure how accurately the system assessed community concerns, how quickly emergency alerts were delivered, and how satisfied the target users: barangay residents, officials, and first responders were with the system.  
Quantitative data were collected through controlled system tests using prepared sample reports and mock emergency alerts. To measure AI accuracy, a set of labeled concern reports were processed through the system's image analysis and text classification components. The scores produced by the system were then compared to human ratings given by barangay officials, and accuracy was calculated based on the degree of agreement between the system's predictions and the officials' assessments. For performance testing, simulated emergency alerts were sent from test smartphones at different locations within the barangay, and server logs recorded the time each alert was sent as well as the time each notification reached the receiving devices.  
Qualitative data were gathered using a survey and open-ended comment sections completed by residents and barangay officials after they finished using the system during user acceptance testing. Participants were asked to share their thoughts on registering an account, submitting a concern, receiving tracking numbers, using the emergency alert feature, and navigating the dashboard. Their responses were reviewed and organized into common themes such as ease of use, clarity of the interface, speed of notifications, and suggestions for improvement. Observer notes were also kept to document any difficulties or smooth experiences observed while participants completed the assigned tasks.

To assess the overall performance and dependability of the E-Boses system, a structured questionnaire was distributed to its key stakeholders namely, barangay residents, local officials, and first responders. The instrument was designed in alignment with the updated ISO/IEC 25010 standard for systems and software quality evaluation, targeting nine core quality attributes: Functional Suitability, Performance Efficiency, Compatibility, Interaction Capability, Reliability, Security, Maintainability, Flexibility, and Safety. Participants evaluated each item using a five-point Likert-type scale, ranging from 1 (Strongly Disagree) to 5 (Strongly Agree), thereby enabling quantitative measurement of perceived system quality. This methodological approach facilitated the systematic collection and analysis of user-centered feedback, supporting a comprehensive, evidence-based appraisal of the system across both functional and non-functional dimensions.

**Statistical Treatments**  
This section presents the statistical tools and techniques used to analyze and interpret the quantitative data gathered during the evaluation of the proposed E-Boses: A Barangay Civic Engagement System with Integrated Emergency Coordination. The study employed descriptive statistical methods, specifically frequency, percentage, weighted mean, and task completion rate, to summarize and evaluate the collected data in alignment with the five project objectives outlined in Chapter 1\.  
The frequency and percentage were used to describe the distribution of responses obtained from the user acceptance testing survey questionnaires administered to residents, barangay officials, and first responders. Frequency refers to the number of participants who selected a particular response option for each Likert item, while percentage represents the proportion of respondents relative to the total number of participants. These measures provided a clear overview of how end-users perceived various aspects of the system, including the civic concern reporting workflow, emergency alert functionality, dashboard clarity, and overall satisfaction with the platform.  
	To quantitatively measure participant responses for the specified variables, a 5-point Likert scale was employed as the primary data collection instrument. This scaling approach ensures that each response is assigned an appropriate numerical value based on its level of agreement or disagreement, allowing the researchers to capture the intensity of user opinions rather than merely binary yes-or-no answers. By weighting each response according to its significance, the method provides a more accurate representation of the overall data, particularly for subjective constructs such as user satisfaction, perceived ease of use, and system usefulness. The specific scale used in this study is adapted from Nyutu et al. (2020), whose 5-point Likert scale was originally validated for measuring participants' agreement related to science learning strategies, and has been modified here to fit the context of barangay civic engagement system evaluation. This adaptation ensures that the instrument is both methodologically sound and contextually appropriate for assessing resident and official feedback on the E-Boses platform.

Table 24  
**Likert Scale Interpretation**

| Scale | Numerical Value | Range | Verbal Interpretation |
| :---: | :---: | :---: | :---: |
| Strongly Agree | 5 | 4.21 \- 5.00 | Very High Satisfaction |
| Agree | 4 | 3.41 \- 4.20 | High Satisfaction |
| Neutral | 3 | 2.61 \- 3.40 | Moderate Satisfaction |
| Disagree | 2 | 1.81 \- 2.60 | Low Satisfaction |
| Strongly Disagree | 1 | 1.00 \- 1.80 | Very Low Satisfaction |

The weighted mean was computed using the formula:  
*X* \= ∑(*f*×*w*)*N*​   
where:  
*X*  \= weighted mean score  
​ ∑(*f*×*w*)  \= sum of the products of response frequency and corresponding weight  
​ *N*   \= total number of respondents

The computed mean scores were interpreted using the predefined scale to determine the level of system usability, user satisfaction, and perceived effectiveness of the E-Boses platform across different user groups, including residents, barangay officials, and first responders.  
These statistical treatments allowed for a clear and objective evaluation of the system's performance. The results provided measurable evidence of the system's effectiveness in improving barangay governance responsiveness and offered insights into user satisfaction based on structured survey responses from verified residents and barangay personnel.

**REFERENCES**  
Arrabaca, F. J. C., & Base, R. L. (2020). *Citizen's level of participation and satisfaction in the conduct of barangay assembly: A case of one Philippine LGU*. Jurnal Ilmiah Peuradeun, 8(2), 377\. https://doi.org/10.26811/peuradeun.v8i2.531

Aquino, R. J., et al. (2025). *BarangayConnect: A web-based information portal for resident data, administrative services, and community records using data analytics and linear regression algorithms*. International Journal of Research and Innovation in Social Science, 9(10). https://doi.org/10.47772/IJRISS

Bacasmas, V. B. (2025). *Barangay initiatives on good governance of selected barangays in Lamitan City, Basilan Province*. International Journal of Multidisciplinary Research and Publications (IJMRAP), 8(1), 761–765. https://ijmrap.com/wp-content/uploads/2025/07/IJMRAP-V8N1P122Y25.pdf 

Brillantes, A. B., Jr., & Moscare, D. *Decentralization and federalism in the Philippines: Lessons from the global community.* International Conference of the East West Center, Kuala Lumpur, Malaysia.

Cosme, C. & De Leon, M. (2024). *Sentiment Analysis of Code-Switched Filipino-English Product and Service Reviews Using Transformers-Based Large Language Models.* 10.1007/978-981-99-8349-0\_11. 

Cruz, J. C. B., & Cheng, C. (2022). *Improving large-scale language models and resources for Filipino*. Proceedings of the 13th Language Resources and Evaluation Conference (pp. 6548–6555). European Language Resources Association. https://aclanthology.org/2022.lrec-1.703/

Doromal, H. O., Rojo, J. M. A., Bulajao, E. J., & Awa, A. L. (2018). *Civic engagement of selected beneficiaries of the social development strategy “Pantawid Pamilyang Pilipino Program” (4Ps) of the Philippine government*. Journal of Multidisciplinary Studies, 7(1), 55–84. https://doi.org/10.7828/jmds.v7i1.1246 

Lacanilao, O. G., & Carpio, C. J. (2025). *Assessing the capabilities and challenges of barangay tanods as first responders: A study in selected barangays in Cabanatuan City*. EPRA International Journal of Multidisciplinary Research, 11(6), 2140–2142. https://doi.org/10.36713/epra22884 

Lacay, N. A. D., Palmas, J. R. D., Villanueva, M. R. M., & Alvero, J. C. M. (2025). *Assessment of community participation and Brgy. officials’ use of ICT in a barangay in the Municipality of San Antonio, Quezon: A basis for an action plan*. Liberales: A Research Journal and Creative Works Folio, 1(1). https://ejournals.ph/article.php?id=25481 

López-Moctezuma, G., Wantchekon, L., Rubenson, D., Fujiwara, T., & Pe Lero, C. (2022). *Policy deliberation and voter persuasion: Experimental evidence from an election in the Philippines*. American Journal of Political Science, 66(1), 59–74. https://doi.org/10.1111/ajps.12566

Malajos, M. J. (2024). *Enhancing barangay governance: A systematic literature review of best practices, challenges, and community perceptions of barangay captains in the Philippines*. SSRN. https://doi.org/10.2139/ssrn.5027145 

Paranga, N., Jr., Gloria, R., Silverio, R., Conge, G., & Pangandaman, C. (2025). *Transforming Barangay Silangan 1: How ethical leadership enhances community projects in Rosario, Cavite*. SSRN. https://doi.org/10.2139/ssrn.5377620 

Qiu, Y., et al. (2025). *Automated urban flood level detection based on flooded bus dataset using YOLOv8*. Natural Hazards and Earth System Sciences, 25, 3525–3544. https://doi.org/10.5194/nhess-25-3525-2025

Rao, B., Feng, J., Huang, C., & Chang, J. (2025). *Design and optimization of urban stray animal supervision model based on YOLOv8 and Flink.* Frontiers in Computing and Intelligent Systems, 12(1). https://doi.org/10.54097/5gx0ry79

Republic of the Philippines. (1991). *Republic Act No. 7160: The Local Government Code of 1991\.* Official Gazette. https://www.officialgazette.gov.ph/1991/10/10/republic-act-no-7160/

Salanga, I. P., Pascual-Dormido, Y., Villanueva, M. M., & Maguate, G. S. (2023). *Difficulties in the implementation of emergency response in a highly-urbanized city: Basis for a capability building plan*. Excellencia: International Multi-Disciplinary Journal of Education, 1(6), 207–233. https://doi.org/10.5281/zenodo.10403842 

Saluky, S., Yuliati, A., & Fikri, A. (2023). *Pothole detection on urban roads using YOLOv8.* 2023 IEEE International Conference on Imaging Systems and Techniques (IST) (pp. 1–6). https://doi.org/10.1109/ICISS59129.2023.10291192

Schiff, K. J. (2023). *Does collective citizen input impact government service provision? Evidence from SeeClickFix requests*. Public Administration Review, 85(1), 32–45. https://doi.org/10.1111/puar.13747

Wang, J., Meng, R., Huang, Y., Zhou, L., Huo, L., Qiao, Z., & Niu, C. (2024). *Road defect detection based on improved YOLOv8s model*. Scientific Reports, 14, Article 16758\. https://doi.org/10.1038/s41598-024-67953-3 

Zabala, C. S. (2024). *Barangay governance gaps: Challenges and opportunities in advancing the Sustainable Development Goals in Zamboanga City, Philippines*. Lex Localis \- Journal of Local Self-Government, 22(S4), 775–784. https://doi.org/10.52152/1925ax36 

Zhou, Y., Lin, L., & Wang, T. (2024). *Garbage classification detection system based on the YOLOv8 algorithm*. AIP Advances, 14(12), 125012\. https://doi.org/10.1063/5.0244795

