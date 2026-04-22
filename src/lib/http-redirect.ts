export function createSeeOtherRedirectResponse(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
    },
  });
}
