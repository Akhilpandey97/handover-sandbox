# Handover public website

## Goal
Build a complete public website for Handover that explains the continuous Closed-Won → Go-Live → Customer Success workflow, using the supplied brief and selective cues from Rocketlane and HubSpot without copying either site.

## What will be built
- A public homepage at `/` with focused navigation, a strong product-led opening, problem/solution narrative, workflow story, integrations, use cases, trust, resources, and one consistent “Book a Demo” call to action.
- Dedicated pages for Product, How It Works, Solutions, Integrations, Customers, Resources, and Book a Demo.
- A separate `/login` page for existing customers; signed-in users keep the current product experience at `/dashboard` and all existing application paths.
- Responsive navigation and footer across every public page.

## Visual direction
- Preserve Handover’s navy and teal identity, adding restrained coral and yellow accents for energy and clearer storytelling.
- Use a bold editorial layout, generous type, compact product UI details, and playful-but-professional transitions inspired by the reference sites.
- Create original product visuals rather than generic stock imagery: a generated opening image plus custom workflow, readiness, risk, integration, and go-live infographics built specifically around Handover.
- Keep animation purposeful and accessible, with reduced-motion support.

## Content and conversion
- Use the supplied positioning: B2B teams with complex post-sales implementation, broken Sales → Delivery handoffs, and faster predictable go-live.
- Show the product through concrete workflows: CRM handoff, delivery readiness, implementation, engineering, customer collaboration, go-live, analytics, and AI-assisted risk detection.
- Avoid invented customer logos, testimonials, certifications, or performance claims. Customer and resource pages will use credible “coming soon / talk to us” content where proof has not been supplied.
- Reuse the working lead-capture flow for demo requests so submissions continue reaching the existing system.

## Technical details
- Add a reusable public-site shell and focused visual components for each infographic.
- Add semantic design tokens in the global style system rather than one-off colors.
- Give every new content page unique title, description, Open Graph title/description, `og:type`, and Twitter card metadata.
- Keep semantic headings, keyboard-accessible controls, useful image alt text, lazy loading below the first viewport, and mobile layouts.
- Preserve all existing authenticated behavior, dashboards, portal links, APIs, and backend data.

## Validation
- Check the public journey, demo form, login entry, and authenticated redirect behavior.
- Verify desktop and mobile layouts, navigation menus, readable text, animations, and infographic framing with browser screenshots.
- Run type checks and a production build after implementation.
