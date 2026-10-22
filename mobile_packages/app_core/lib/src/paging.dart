/// One page of a cursor-paginated list.
class PageResult<T> {
  const PageResult({required this.items, this.nextCursor});
  final List<T> items;
  final String? nextCursor;
  bool get hasMore => nextCursor != null;
}
